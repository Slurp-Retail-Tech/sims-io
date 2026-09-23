/**
 * Rendering an invoice to PDF and keeping it in object storage.
 *
 * The object key deliberately does NOT use one of `OBJECT_KEY_PREFIXES`. The
 * generic authenticated proxy at `/api/uploads/view` only serves allowlisted
 * prefixes, so an invoice PDF can never be fetched through it by any signed-in
 * user. Invoices are reachable only through the staff route that checks the
 * invoices key, and through the token-gated public route.
 *
 * Rendering is idempotent: a stored key is reused unless `force` is set, and a
 * re-render overwrites the same key so there is one object per invoice.
 */

import getPool, { type Queryable } from "../db.ts"
import type { ResultSetHeader } from "mysql2/promise"

import { createLogger } from "../logger.ts"
import { renderRenewalDocument } from "../pdf/renewal-documents.ts"
import type { DocumentLine, RenewalDocument } from "../pdf/renewal-documents.ts"
import { getObjectBuffer, uploadObject } from "../storage.ts"
import { addMonths } from "./invoice-build.ts"
import {
  findTaxInvoiceForProforma,
  getInvoiceById,
  loadInvoiceItems,
  recordEvent,
} from "./invoices.ts"
import type { InvoiceItemRecord, InvoiceRecord } from "./invoices.ts"
import { toObjectKeySafeNumber } from "./numbering.ts"
import { TERM_MONTHS } from "./plan-resolution.ts"
import { buildSellerBlock } from "./seller.ts"
import type { SellerSettings } from "./seller.ts"
import { loadRenewalSettings } from "./settings.ts"

const log = createLogger("renewal:invoice-pdf")

export const INVOICE_PDF_PREFIX = "renewal-invoices"

/**
 * `renewal-invoices/2026/PI-2026-09-014.pdf`.
 *
 * Year from the issue date so a year's documents sit together; the number
 * itself is unique across live invoices, so no random suffix is needed.
 */
export function invoicePdfObjectKey(
  invoiceNumber: string,
  issueDate: string | null
): string {
  const year = /^(\d{4})/.exec(issueDate ?? "")?.[1] ?? "undated"
  return `${INVOICE_PDF_PREFIX}/${year}/${toObjectKeySafeNumber(invoiceNumber)}.pdf`
}

/** The merchant-facing link for a token. */
export function buildRenewalLink(renewalToken: string): string {
  const base = (process.env.APP_BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "")
  return `${base}/renew/${renewalToken}`
}

/**
 * The "from" block on every document, from Renewal Settings with the
 * `RENEWAL_SELLER_*` environment variables as a fallback. See `seller.ts`.
 */
export function sellerBlockFor(settings: SellerSettings): RenewalDocument["seller"] {
  return buildSellerBlock(settings, process.env)
}

const TERM_LABELS: Record<string, string> = {
  annually: "1 year",
  bi_annually: "6 months",
}

export type DocumentOptions = {
  payLink: string | null
  /** The letterhead; see `sellerBlockFor`. */
  seller: RenewalDocument["seller"]
  /** Force the document kind; defaults to the invoice's own type. */
  kind?: RenewalDocument["kind"]
  /** The proforma a tax invoice or receipt settles, or the tax invoice a receipt cites. */
  referenceNumber?: string | null
  /** Gateway transaction number or the bank reference of an offline payment. */
  paymentReference?: string | null
}

/** Shape database rows into the document model the renderer takes. */
export function buildProformaDocument(
  invoice: InvoiceRecord,
  items: readonly InvoiceItemRecord[],
  options: DocumentOptions
): RenewalDocument {
  const kind: RenewalDocument["kind"] =
    options.kind ?? (invoice.documentType === "tax_invoice" ? "tax_invoice" : "proforma")

  const lines: DocumentLine[] = items.map((item) => {
    const periodStart = item.previousValidUntil
      ? item.previousValidUntil.slice(0, 10)
      : null
    const months = TERM_MONTHS[item.billingPlan]
    // Once extended, the line carries the date the licence actually moved to;
    // before that the period end is projected from the previous expiry.
    const periodEnd = item.newValidUntil
      ? item.newValidUntil.slice(0, 10)
      : periodStart
        ? addMonths(periodStart, months)
        : null
    return {
      outletName: item.outletName,
      outletId: item.outletId,
      licensePlan: item.licensePlan,
      termLabel: TERM_LABELS[item.billingPlan] ?? item.billingPlan,
      periodStart,
      periodEnd,
      catalogMinor: item.catalogAmountMinor,
      adjustmentMinor: item.adjustmentAmountMinor,
      amountMinor: item.effectiveAmountMinor,
    }
  })

  const notes: string[] = []
  if (invoice.taxRatePercent === 0) {
    notes.push("Prices are exclusive of tax. No tax is charged on this document.")
  }
  if (kind === "proforma") {
    notes.push(
      "The new expiry date for each outlet is counted from its previous expiry, not from the payment date."
    )
  }

  return {
    kind,
    invoiceNumber: invoice.invoiceNumber,
    referenceNumber: options.referenceNumber ?? null,
    issueDate: invoice.issueDate,
    dueDate: invoice.dueDate,
    paidAt: invoice.paidAt,
    paymentReference: options.paymentReference ?? null,
    currencyCode: invoice.currencyCode,
    billTo: {
      companyName: invoice.companyName,
      franchiseId: invoice.franchiseId,
      email: invoice.paymentEmail,
    },
    seller: options.seller,
    lines,
    totals: {
      subtotalMinor: invoice.subtotalMinor,
      adjustmentMinor: invoice.adjustmentMinor,
      taxRatePercent: invoice.taxRatePercent,
      taxMinor: invoice.taxMinor,
      totalMinor: invoice.totalMinor,
    },
    payLink: kind === "proforma" ? options.payLink : null,
    notes,
  }
}

/** What a paid document cites as its payment reference. */
export function paymentReferenceOf(invoice: InvoiceRecord): string | null {
  return invoice.capTransactionNumber ?? invoice.paidReference ?? null
}

function storageBucket(): string {
  const bucket = process.env.MINIO_BUCKET?.trim()
  if (!bucket) {
    throw new Error("MINIO_BUCKET is not set; cannot store invoice PDFs.")
  }
  return bucket
}

export type EnsurePdfResult = {
  objectKey: string
  /** True when a document was rendered on this call. */
  rendered: boolean
}

/**
 * Make sure the invoice has a stored PDF, rendering one if it does not.
 *
 * `force` re-renders over the existing key, for when the invoice changed (a
 * term switch reprices every line) and the stored document is stale.
 */
export async function ensureInvoicePdf(
  invoiceId: string,
  options: { force?: boolean; actorUserId?: string | null } = {},
  db: Queryable = getPool()
): Promise<EnsurePdfResult> {
  const invoice = await getInvoiceById(invoiceId, db)
  if (!invoice) {
    throw new Error(`Invoice ${invoiceId} not found.`)
  }

  if (invoice.pdfObjectKey && !options.force) {
    return { objectKey: invoice.pdfObjectKey, rendered: false }
  }

  const [items, settings] = await Promise.all([loadInvoiceItems(invoiceId, db), loadRenewalSettings(db)])
  // A tax invoice cites the proforma it settles and the payment that settled it.
  const parent =
    invoice.documentType === "tax_invoice" && invoice.parentInvoiceId
      ? await getInvoiceById(invoice.parentInvoiceId, db)
      : null
  const document = buildProformaDocument(invoice, items, {
    payLink: invoice.renewalToken ? buildRenewalLink(invoice.renewalToken) : null,
    seller: sellerBlockFor(settings),
    referenceNumber: parent?.invoiceNumber ?? null,
    paymentReference: invoice.documentType === "tax_invoice" ? paymentReferenceOf(invoice) : null,
  })
  const bytes = await renderRenewalDocument(document)

  const objectKey = invoice.pdfObjectKey ?? invoicePdfObjectKey(invoice.invoiceNumber, invoice.issueDate)
  await uploadObject({
    bucket: storageBucket(),
    key: objectKey,
    body: Buffer.from(bytes),
    contentType: "application/pdf",
  })

  await db.query<ResultSetHeader>(
    `UPDATE renewal_invoices SET pdf_object_key = ? WHERE id = ?`,
    [objectKey, invoiceId]
  )
  await recordEvent(db, invoiceId, "pdf_rendered", options.actorUserId ?? null, {
    objectKey,
    bytes: bytes.byteLength,
    forced: Boolean(options.force),
  })

  return { objectKey, rendered: true }
}

/** `renewal-invoices/2026/PI-2026-09-014-receipt.pdf`, beside the proforma. */
export function receiptPdfObjectKey(invoiceNumber: string, issueDate: string | null): string {
  return invoicePdfObjectKey(invoiceNumber, issueDate).replace(/\.pdf$/, "-receipt.pdf")
}

/**
 * Make sure a paid proforma has its receipt rendered and stored.
 *
 * The receipt is the merchant's document: the proforma number they were
 * chasing all along, the amount, the payment reference, and every outlet's
 * new expiry. It cites the tax invoice number where one has been issued.
 */
export async function ensureReceiptPdf(
  invoiceId: string,
  options: { force?: boolean } = {},
  db: Queryable = getPool()
): Promise<EnsurePdfResult> {
  const invoice = await getInvoiceById(invoiceId, db)
  if (!invoice) {
    throw new Error(`Invoice ${invoiceId} not found.`)
  }
  if (invoice.status !== "paid") {
    throw new Error(`Invoice ${invoiceId} is not paid; no receipt to render.`)
  }
  if (invoice.receiptPdfObjectKey && !options.force) {
    return { objectKey: invoice.receiptPdfObjectKey, rendered: false }
  }

  const [items, taxInvoice, settings] = await Promise.all([
    loadInvoiceItems(invoiceId, db),
    findTaxInvoiceForProforma(invoiceId, db),
    loadRenewalSettings(db),
  ])
  const document = buildProformaDocument(invoice, items, {
    payLink: null,
    seller: sellerBlockFor(settings),
    kind: "receipt",
    referenceNumber: taxInvoice ? `Tax invoice ${taxInvoice.invoiceNumber}` : null,
    paymentReference: paymentReferenceOf(invoice),
  })
  const bytes = await renderRenewalDocument(document)

  const objectKey = invoice.receiptPdfObjectKey ?? receiptPdfObjectKey(invoice.invoiceNumber, invoice.issueDate)
  await uploadObject({
    bucket: storageBucket(),
    key: objectKey,
    body: Buffer.from(bytes),
    contentType: "application/pdf",
  })
  await db.query<ResultSetHeader>(
    `UPDATE renewal_invoices SET receipt_pdf_object_key = ? WHERE id = ?`,
    [objectKey, invoiceId]
  )
  await recordEvent(db, invoiceId, "receipt_rendered", null, {
    objectKey,
    bytes: bytes.byteLength,
    forced: Boolean(options.force),
  })
  return { objectKey, rendered: true }
}

/** The stored receipt bytes, rendering first if nothing is stored yet. */
export async function loadReceiptPdf(
  invoiceId: string,
  db: Queryable = getPool()
): Promise<{ bytes: Buffer; fileName: string }> {
  const { objectKey } = await ensureReceiptPdf(invoiceId, {}, db)
  const bytes = await getObjectBuffer(storageBucket(), objectKey)
  const fileName = objectKey.slice(objectKey.lastIndexOf("/") + 1)
  return { bytes: Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes), fileName }
}

/**
 * Render on a best-effort basis from the nightly cycle.
 *
 * A storage outage must not stop the invoice existing or the cycle finishing;
 * the staff and public routes render on demand if the stored copy is missing.
 */
export async function renderInvoicePdfSafely(invoiceId: string): Promise<void> {
  try {
    await ensureInvoicePdf(invoiceId)
  } catch (error) {
    log.error("Invoice PDF render failed; will render on demand", error, {
      invoiceId,
    })
  }
}

/** The stored bytes, rendering first if nothing is stored yet. */
export async function loadInvoicePdf(
  invoiceId: string,
  db: Queryable = getPool()
): Promise<{ bytes: Buffer; fileName: string }> {
  const { objectKey } = await ensureInvoicePdf(invoiceId, {}, db)
  const bytes = await getObjectBuffer(storageBucket(), objectKey)
  const fileName = objectKey.slice(objectKey.lastIndexOf("/") + 1)
  return { bytes: Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes), fileName }
}
