"use client"

import * as React from "react"
import Image from "next/image"
import { Moon, Sun } from "lucide-react"
import { useTheme } from "next-themes"

import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

type CategoryNode = {
  id: string
  name: string
  sortOrder: number
  subcategories: CategoryNode[]
}

function digitsOnly(value: string) {
  return value.replace(/\D+/g, "")
}

function withLeadingSix(value: string) {
  if (!value) {
    return value
  }
  return value.startsWith("6") ? value : `6${value}`
}

const supportPhone = process.env.NEXT_PUBLIC_SUPPORT_PHONE ?? ""
const supportEmail = process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? ""
const supportContact =
  supportPhone || supportEmail
    ? [supportPhone ? `📞 ${supportPhone}` : null, supportEmail ? `✉️ ${supportEmail}` : null]
        .filter(Boolean)
        .join(" · ")
    : ""

const copy = {
  en: {
    heroKicker: "Merchant Success",
    heroTitle: "Submit a Support Ticket",
    heroDescription:
      "Please fill all required information. Fields marked with * are mandatory. We will follow up based on your submitted contact details.",
    heroContact: supportContact,
    helpTitle: "How to find FID & OID",
    helpClose: "Close",
    helpLink: "Where can I find this?",
    section1Title: "Merchant Information",
    section1Desc:
      "Provide outlet identifiers and contact details so we can locate you quickly.",
    section2Title: "Issue Details",
    section2Desc: "Describe the issue so we can reproduce and resolve it.",
    section3Title: "Supporting Documents",
    section3Desc:
      "Upload screenshots, receipts, or any other files that help our team troubleshoot faster.",
    section3Note: "Supported file types: JPEG, PNG, HEIC, PDF. Max size 10 MB per file.",
    fidLabel: "FID*",
    oidLabel: "OID*",
    nameLabel: "Full Name*",
    phoneLabel: "Contact Number*",
    categoryLabel: "Category*",
    subcategory1Label: "Subcategory 1*",
    subcategory2Label: "Subcategory 2 (If applicable)",
    descriptionLabel: "Describe the issue*",
    attachment1Label: "Attachment 1 (optional)",
    attachment2Label: "Attachment 2 (optional)",
    attachment3Label: "Attachment 3 (optional)",
    fidPlaceholder: "1234",
    oidPlaceholder: "12",
    namePlaceholder: "Enter your full name",
    phonePlaceholder: "60123456789",
    descriptionPlaceholder:
      "Include steps to reproduce, error messages, payment IDs, affected devices, etc.",
    categoriesLoading: "Loading categories...",
    selectCategory: "Select a category",
    selectSubcategory: "Select a subcategory",
    selectCategoryFirst: "Select a category first",
    noSubcategory: "No subcategory available",
    tipsTitle: "Tips for faster resolution",
    tips: [
      "Provide transaction IDs when reporting payment issues.",
      "Attach clear screenshots of error messages or hardware screens.",
      "Mention the affected outlet, POS device, and the exact time of the issue.",
    ],
    clearForm: "Clear form",
    submit: "Submit Ticket",
    submitting: "Submitting...",
    footer:
      "After submitting, our Merchant Success team will review your request and contact you.",
    successSubmit: "Support request submitted successfully.",
    errorRequired: "Please fill in all required fields.",
    errorNumbersOnly: "FID, OID, and Contact Number must contain numbers only.",
    errorCategories: "Unable to load categories. Please refresh and try again.",
    errorSubmit: "Unable to submit the support request.",
    langHint: "Click to change language",
    langLabel: "EN | BM",
  },
  bm: {
    heroKicker: "Merchant Success",
    heroTitle: "Hantar Tiket Sokongan",
    heroDescription:
      "Sila isi semua maklumat yang diperlukan. Ruangan yang ditandakan dengan * adalah wajib. Kami akan membuat susulan berdasarkan butiran hubungan yang dihantar.",
    heroContact: supportContact,
    helpTitle: "Cara mencari FID & OID",
    helpClose: "Tutup",
    helpLink: "Di mana saya boleh jumpa ini?",
    section1Title: "Maklumat Peniaga",
    section1Desc:
      "Isi ID outlet dan butiran hubungan supaya kami boleh menemui anda dengan cepat.",
    section2Title: "Butiran Isu",
    section2Desc: "Terangkan isu supaya kami boleh menirunya dan menyelesaikannya.",
    section3Title: "Dokumen Sokongan",
    section3Desc:
      "Muat naik tangkapan skrin, resit atau mana-mana fail lain yang membantu kami menyelesaikan isu dengan pantas.",
    section3Note:
      "Jenis fail disokong: JPEG, PNG, HEIC, PDF. Saiz maksimum 10 MB bagi setiap fail.",
    fidLabel: "FID*",
    oidLabel: "OID*",
    nameLabel: "Nama Penuh*",
    phoneLabel: "Nombor Telefon*",
    categoryLabel: "Kategori*",
    subcategory1Label: "Subkategori 1*",
    subcategory2Label: "Subkategori 2 (Jika berkenaan)",
    descriptionLabel: "Terangkan isu*",
    attachment1Label: "Lampiran 1 (pilihan)",
    attachment2Label: "Lampiran 2 (pilihan)",
    attachment3Label: "Lampiran 3 (pilihan)",
    fidPlaceholder: "1234",
    oidPlaceholder: "12",
    namePlaceholder: "Masukkan nama penuh anda",
    phonePlaceholder: "60123456789",
    descriptionPlaceholder:
      "Sertakan langkah mengulangi isu, mesej ralat, ID pembayaran, peranti terjejas dan sebagainya.",
    categoriesLoading: "Memuatkan kategori...",
    selectCategory: "Pilih kategori",
    selectSubcategory: "Pilih subkategori",
    selectCategoryFirst: "Pilih kategori terlebih dahulu",
    noSubcategory: "Tiada subkategori tersedia",
    tipsTitle: "Petua untuk penyelesaian lebih pantas",
    tips: [
      "Berikan ID transaksi apabila melaporkan isu pembayaran.",
      "Lampirkan tangkapan skrin jelas bagi mesej ralat atau paparan perkakasan.",
      "Nyatakan outlet terjejas, peranti POS dan masa tepat isu berlaku.",
    ],
    clearForm: "Padam borang",
    submit: "Hantar Tiket",
    submitting: "Menghantar...",
    footer:
      "Selepas dihantar, pasukan Merchant Success kami akan menyemak permintaan anda dan menghubungi anda.",
    successSubmit: "Permintaan sokongan berjaya dihantar.",
    errorRequired: "Sila lengkapkan semua medan yang diperlukan.",
    errorNumbersOnly: "FID, OID, dan Nombor Telefon mesti mengandungi nombor sahaja.",
    errorCategories: "Gagal memuatkan kategori. Sila cuba semula.",
    errorSubmit: "Gagal menghantar permintaan sokongan.",
    langHint: "Klik untuk tukar bahasa",
    langLabel: "EN | BM",
  },
} as const

export default function SupportFormPage() {
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = React.useState(false)
  const [categories, setCategories] = React.useState<CategoryNode[]>([])
  const [loadingCategories, setLoadingCategories] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [success, setSuccess] = React.useState<string | null>(null)
  const [submitting, setSubmitting] = React.useState(false)
  const [showHelp, setShowHelp] = React.useState(false)
  const [language, setLanguage] = React.useState<keyof typeof copy>("en")

  const [fid, setFid] = React.useState("")
  const [oid, setOid] = React.useState("")
  const [merchantName, setMerchantName] = React.useState("")
  const [phoneNumber, setPhoneNumber] = React.useState("")
  const [categoryId, setCategoryId] = React.useState("")
  const [subcategory1Id, setSubcategory1Id] = React.useState("")
  const [subcategory2Id, setSubcategory2Id] = React.useState("")
  const [description, setDescription] = React.useState("")

  const formRef = React.useRef<HTMLFormElement | null>(null)

  React.useEffect(() => {
    setMounted(true)
  }, [])

  React.useEffect(() => {
    const load = async () => {
      setLoadingCategories(true)
      try {
        const response = await fetch("/api/supportform/categories")
        if (!response.ok) {
          throw new Error(copy.en.errorCategories)
        }
        const data = (await response.json()) as { categories: CategoryNode[] }
        setCategories(data.categories ?? [])
        setError(null)
      } catch (err) {
        console.error(err)
        setError(copy[language].errorCategories)
      } finally {
        setLoadingCategories(false)
      }
    }
    void load()
  }, [language])

  const selectedCategory = React.useMemo(
    () => categories.find((category) => category.id === categoryId) ?? null,
    [categories, categoryId]
  )

  const subcategory1Options = React.useMemo(
    () => selectedCategory?.subcategories ?? [],
    [selectedCategory]
  )
  const selectedSubcategory1 = React.useMemo(
    () => subcategory1Options.find((item) => item.id === subcategory1Id) ?? null,
    [subcategory1Options, subcategory1Id]
  )
  const subcategory2Options = selectedSubcategory1?.subcategories ?? []

  React.useEffect(() => {
    setSubcategory1Id("")
    setSubcategory2Id("")
  }, [categoryId])

  React.useEffect(() => {
    setSubcategory2Id("")
  }, [subcategory1Id])

  const handleReset = () => {
    setFid("")
    setOid("")
    setMerchantName("")
    setPhoneNumber("")
    setCategoryId("")
    setSubcategory1Id("")
    setSubcategory2Id("")
    setDescription("")
    setError(null)
    setSuccess(null)
    if (formRef.current) {
      formRef.current.reset()
    }
  }

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    setSuccess(null)
    if (submitting) {
      return
    }

    if (!fid || !oid || !merchantName || !phoneNumber || !categoryId || !subcategory1Id || !description) {
      setError(copy[language].errorRequired)
      return
    }

    if (!/^\d+$/.test(fid) || !/^\d+$/.test(oid) || !/^\d+$/.test(phoneNumber)) {
      setError(copy[language].errorNumbersOnly)
      return
    }
    const normalizedPhoneNumber = withLeadingSix(phoneNumber)
    if (normalizedPhoneNumber !== phoneNumber) {
      setPhoneNumber(normalizedPhoneNumber)
    }

    const categoryName = selectedCategory?.name ?? ""
    const subcategory1Name = selectedSubcategory1?.name ?? ""
    const subcategory2Name = subcategory2Options.find((item) => item.id === subcategory2Id)?.name ?? ""

    try {
      setSubmitting(true)
      const formData = new FormData(event.currentTarget)
      formData.set("fid", fid)
      formData.set("oid", oid)
      formData.set("merchant_name", merchantName)
      formData.set("phone_number", normalizedPhoneNumber)
      formData.set("issue_type", categoryName)
      formData.set("issue_subcategory1", subcategory1Name)
      formData.set("issue_subcategory2", subcategory2Name)
      formData.set("issue_description", description)

      const response = await fetch("/api/supportform/submit", {
        method: "POST",
        body: formData,
      })

      const payload = (await response.json()) as {
        requestId?: string
        error?: string
        franchiseName?: string | null
        outletName?: string | null
        whatsappUrl?: string | null
      }
      if (!response.ok || !payload.requestId) {
        throw new Error(payload.error ?? copy[language].errorSubmit)
      }

      const messageLines = [
        "*New Support Request*",
        "",
        `*Merchant:* ${merchantName}`,
        `*Franchise:* ${payload.franchiseName ?? "-"} / ${fid}`,
        `*Outlet:* ${payload.outletName ?? merchantName} / ${oid}`,
        "",
        `*Category:* ${categoryName}`,
        ...(subcategory1Name ? [`*Subcategory 1:* ${subcategory1Name}`] : []),
        ...(subcategory2Name ? [`*Subcategory 2:* ${subcategory2Name}`] : []),
        "",
        `*Description:* ${description}`,
        "",
        `*Request ID:* #${payload.requestId}`,
      ]
      if (!payload.whatsappUrl) {
        throw new Error("WhatsApp link is unavailable.")
      }
      const chatMessage = encodeURIComponent(messageLines.join("\n"))
      window.location.href = `${payload.whatsappUrl}?text=${chatMessage}`
    } catch (err) {
      console.error(err)
      setError(err instanceof Error ? err.message : "Unable to submit the support request.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="relative min-h-svh overflow-hidden px-4 py-10 text-foreground">
      {showHelp ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-lg font-semibold">{copy[language].helpTitle}</h2>
              <button
                type="button"
                className="rounded-full border border-border px-3 py-1 text-sm text-muted-foreground hover:bg-muted"
                onClick={() => setShowHelp(false)}
              >
                {copy[language].helpClose}
              </button>
            </div>
            <div className="mt-4 overflow-hidden rounded-xl border border-border bg-muted">
              <Image
                src="/assets/fid-oid-help.svg"
                alt="Screenshot showing where to find the FID and OID."
                className="h-auto w-full"
                width={1200}
                height={700}
              />
            </div>
          </div>
        </div>
      ) : null}

      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <header className="rounded-2xl border border-border bg-[linear-gradient(135deg,#ef4444_0%,#f97316_60%,#fb7185_100%)] p-6 text-white shadow-sm">
          <div className="mb-4 flex justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              className="border-white/50 bg-white/20 text-white hover:bg-white/30 hover:text-white"
              onClick={() =>
                setTheme(mounted && resolvedTheme === "dark" ? "light" : "dark")
              }
            >
              {mounted && resolvedTheme === "dark" ? (
                <>
                  <Sun className="size-4" />
                  Light
                </>
              ) : (
                <>
                  <Moon className="size-4" />
                  Dark
                </>
              )}
            </Button>
            <Button
              variant={language === "en" ? "default" : "outline"}
              size="sm"
              className={
                language === "en"
                  ? "bg-white text-rose-600 hover:bg-white/90"
                  : "border-white/50 bg-white/20 text-white hover:bg-white/30 hover:text-white"
              }
              onClick={() => setLanguage("en")}
            >
              EN
            </Button>
            <Button
              variant={language === "bm" ? "default" : "outline"}
              size="sm"
              className={
                language === "bm"
                  ? "bg-white text-rose-600 hover:bg-white/90"
                  : "border-white/50 bg-white/20 text-white hover:bg-white/30 hover:text-white"
              }
              onClick={() => setLanguage("bm")}
            >
              BM
            </Button>
          </div>
          <div className="flex flex-col gap-4">
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/20 text-2xl backdrop-blur">
                💬
              </div>
              <div>
                <p className="text-sm font-semibold uppercase tracking-wide text-white/80">
                  {copy[language].heroKicker}
                </p>
                <h1 className="text-2xl font-semibold">{copy[language].heroTitle}</h1>
                <p className="mt-2 text-sm text-white/90">
                  {copy[language].heroDescription}
                </p>
                {copy[language].heroContact ? (
                  <p className="mt-3 text-sm text-white/90">
                    {copy[language].heroContact}
                  </p>
                ) : null}
              </div>
            </div>
          </div>
        </header>

        <form
          ref={formRef}
          onSubmit={handleSubmit}
          className="rounded-2xl border border-border bg-card p-6 shadow-sm"
        >
          <div className="flex flex-col gap-8">
            <section className="space-y-4 rounded-2xl border border-border bg-background p-5">
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
                  1
                </div>
                <div>
                  <h2 className="text-lg font-semibold">{copy[language].section1Title}</h2>
                  <p className="text-sm text-muted-foreground">
                    {copy[language].section1Desc}
                  </p>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium" htmlFor="fid">
                      {copy[language].fidLabel}
                    </label>
                    <button
                      type="button"
                      className="text-xs font-semibold text-primary hover:text-primary/80"
                      onClick={() => setShowHelp(true)}
                    >
                      {copy[language].helpLink}
                    </button>
                  </div>
                  <input
                    id="fid"
                    name="fid"
                    required
                    inputMode="numeric"
                    pattern="[0-9]*"
                    placeholder={copy[language].fidPlaceholder}
                    value={fid}
                    onChange={(event) => setFid(digitsOnly(event.target.value))}
                    className="h-10 rounded-lg border border-input bg-background px-3 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-medium" htmlFor="oid">
                    {copy[language].oidLabel}
                  </label>
                  <input
                    id="oid"
                    name="oid"
                    required
                    inputMode="numeric"
                    pattern="[0-9]*"
                    placeholder={copy[language].oidPlaceholder}
                    value={oid}
                    onChange={(event) => setOid(digitsOnly(event.target.value))}
                    className="h-10 rounded-lg border border-input bg-background px-3 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-medium" htmlFor="merchant_name">
                    {copy[language].nameLabel}
                  </label>
                  <input
                    id="merchant_name"
                    name="merchant_name"
                    required
                    placeholder={copy[language].namePlaceholder}
                    value={merchantName}
                    onChange={(event) => setMerchantName(event.target.value)}
                    className="h-10 rounded-lg border border-input bg-background px-3 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-medium" htmlFor="phone_number">
                    {copy[language].phoneLabel}
                  </label>
                  <input
                    id="phone_number"
                    name="phone_number"
                    required
                    inputMode="numeric"
                    pattern="[0-9]*"
                    placeholder={copy[language].phonePlaceholder}
                    value={phoneNumber}
                    onChange={(event) => setPhoneNumber(digitsOnly(event.target.value))}
                    onBlur={() => setPhoneNumber((prev) => withLeadingSix(prev))}
                    className="h-10 rounded-lg border border-input bg-background px-3 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                </div>
              </div>
            </section>

            <section className="space-y-4 rounded-2xl border border-border bg-background p-5">
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
                  2
                </div>
                <div>
                  <h2 className="text-lg font-semibold">{copy[language].section2Title}</h2>
                  <p className="text-sm text-muted-foreground">
                    {copy[language].section2Desc}
                  </p>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-medium" htmlFor="issue_type">
                    {copy[language].categoryLabel}
                  </label>
                  <Select
                    value={categoryId}
                    onValueChange={setCategoryId}
                    disabled={loadingCategories}
                  >
                    <SelectTrigger className="h-10 rounded-lg border border-input bg-background px-3 text-sm focus:border-primary focus:outline-none">
                      <SelectValue
                        placeholder={
                          loadingCategories
                            ? copy[language].categoriesLoading
                            : copy[language].selectCategory
                        }
                      />
                    </SelectTrigger>
                    <SelectContent className="bg-popover">
                      {categories.map((category) => (
                        <SelectItem key={category.id} value={category.id}>
                          {category.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-medium" htmlFor="issue_subcategory1">
                    {copy[language].subcategory1Label}
                  </label>
                  <Select
                    value={subcategory1Id}
                    onValueChange={setSubcategory1Id}
                    disabled={!subcategory1Options.length}
                  >
                    <SelectTrigger className="h-10 rounded-lg border border-input bg-background px-3 text-sm focus:border-primary focus:outline-none">
                      <SelectValue
                        placeholder={
                          subcategory1Options.length
                            ? copy[language].selectSubcategory
                            : copy[language].selectCategoryFirst
                        }
                      />
                    </SelectTrigger>
                    <SelectContent className="bg-popover">
                      {subcategory1Options.map((subcategory) => (
                        <SelectItem key={subcategory.id} value={subcategory.id}>
                          {subcategory.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {subcategory2Options.length ? (
                  <div className="flex flex-col gap-2 sm:col-span-2">
                    <label className="text-sm font-medium" htmlFor="issue_subcategory2">
                      {copy[language].subcategory2Label}
                    </label>
                    <Select value={subcategory2Id} onValueChange={setSubcategory2Id}>
                      <SelectTrigger className="h-10 rounded-lg border border-input bg-background px-3 text-sm focus:border-primary focus:outline-none">
                        <SelectValue placeholder={copy[language].selectSubcategory} />
                      </SelectTrigger>
                      <SelectContent className="bg-popover">
                        {subcategory2Options.map((subcategory) => (
                          <SelectItem key={subcategory.id} value={subcategory.id}>
                            {subcategory.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}
                <div className="flex flex-col gap-2 sm:col-span-2">
                  <label className="text-sm font-medium" htmlFor="issue_description">
                    {copy[language].descriptionLabel}
                  </label>
                  <textarea
                    id="issue_description"
                    name="issue_description"
                    required
                    placeholder={copy[language].descriptionPlaceholder}
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    className="min-h-[130px] rounded-lg border border-input bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                </div>
              </div>

              <div className="rounded-xl border border-dashed border-border bg-muted/40 p-4 text-sm text-foreground">
                <strong className="block font-semibold">{copy[language].tipsTitle}</strong>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
                  {copy[language].tips.map((tip) => (
                    <li key={tip} className="text-muted-foreground">
                      {tip}
                    </li>
                  ))}
                </ul>
              </div>
            </section>

            <section className="space-y-4 rounded-2xl border border-border bg-background p-5">
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
                  3
                </div>
                <div>
                  <h2 className="text-lg font-semibold">{copy[language].section3Title}</h2>
                  <p className="text-sm text-muted-foreground">
                    {copy[language].section3Desc}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {copy[language].section3Note}
                  </p>
                </div>
              </div>

              <div className="grid gap-4">
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-medium" htmlFor="attachment">
                    {copy[language].attachment1Label}
                  </label>
                  <input
                    id="attachment"
                    type="file"
                    name="attachment"
                    accept="image/jpeg,image/png,image/heic,application/pdf"
                    className="w-full rounded-lg border border-input bg-background p-2 text-sm"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-medium" htmlFor="attachment_receipt">
                    {copy[language].attachment2Label}
                  </label>
                  <input
                    id="attachment_receipt"
                    type="file"
                    name="attachment_receipt"
                    accept="image/jpeg,image/png,image/heic,application/pdf"
                    className="w-full rounded-lg border border-input bg-background p-2 text-sm"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-medium" htmlFor="attachment_other">
                    {copy[language].attachment3Label}
                  </label>
                  <input
                    id="attachment_other"
                    type="file"
                    name="attachment_other"
                    accept="image/jpeg,image/png,image/heic,application/pdf"
                    className="w-full rounded-lg border border-input bg-background p-2 text-sm"
                  />
                </div>
              </div>
            </section>

            {error ? (
              <div className="rounded-xl border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive">
                {error}
              </div>
            ) : null}
            {success ? (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">
                {success}
              </div>
            ) : null}

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <button
                type="reset"
                onClick={handleReset}
                className="rounded-lg border border-border bg-white px-4 py-2 text-sm font-semibold text-foreground hover:bg-muted"
              >
                {copy[language].clearForm}
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {submitting ? copy[language].submitting : copy[language].submit}
              </button>
            </div>
          </div>
        </form>

        <div className="text-center text-sm text-muted-foreground">
          {copy[language].footer}
        </div>
      </div>
    </div>
  )
}
