/**
 * Shaping a `PublicInvoice` into the fields `RenewalDocumentCard` renders.
 *
 * The wording, figures and order come from `src/lib/renewal/document-content`,
 * the same module the printed PDF reads, so the page and the paper copy say
 * the same thing. This file only maps the public view onto it.
 */

import {
  buildBillTo as contentBillTo,
  buildDocLines as contentDocLines,
  buildDocMeta,
  buildDocTitle as contentDocTitle,
  buildShipTo as contentShipTo,
} from "@/lib/renewal/document-content"
import type {
  DocMetaRow,
  DocumentKind,
  DocumentLineRow,
  DocumentSource,
} from "@/lib/renewal/document-content"

import type { PublicInvoice } from "./types"

export function documentSourceFor(view: PublicInvoice, kind: DocumentKind = "proforma"): DocumentSource {
  return {
    kind,
    invoiceNumber: view.invoiceNumber,
    taxInvoiceNumber: view.taxInvoiceNumber,
    issueDate: view.issueDate,
    dueDate: view.dueDate,
    paidAt: view.payment.paidAt,
    paidVia: view.paidVia,
    paymentReference: view.paymentReference,
    companyName: view.companyName,
    franchiseId: view.franchiseId,
    paymentEmail: view.paymentEmail,
    isGrouped: view.isGrouped,
    outletCount: view.outletCount,
    term: view.term,
    periodEnd: view.periodEnd,
    currencyCode: view.currencyCode,
    lines: view.lines,
    totals: {
      subtotalMinor: view.totals.subtotalMinor,
      taxRatePercent: view.taxRatePercent,
      taxMinor: view.totals.taxMinor,
      totalMinor: view.totals.totalMinor,
    },
  }
}

export function buildBillTo(view: PublicInvoice): { name: string; lines: string[] } {
  return contentBillTo(documentSourceFor(view))
}

export function buildShipTo(view: PublicInvoice): { name: string; lines: string[] } {
  return contentShipTo(documentSourceFor(view))
}

export function buildDocTitle(view: PublicInvoice, suffix?: string): string {
  return contentDocTitle(documentSourceFor(view), suffix)
}

export function buildDocLines(view: PublicInvoice): DocumentLineRow[] {
  return contentDocLines(documentSourceFor(view))
}

export function buildProformaDocMeta(view: PublicInvoice): DocMetaRow[] {
  return buildDocMeta(documentSourceFor(view, "proforma"))
}

export function buildReceiptDocMeta(view: PublicInvoice): DocMetaRow[] {
  return buildDocMeta(documentSourceFor(view, "receipt"))
}
