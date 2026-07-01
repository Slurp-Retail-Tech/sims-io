"use client"

import * as React from "react"
import Image from "next/image"
import Script from "next/script"

import styles from "./demoform.module.css"

const businessTypes = [
  "Restaurant",
  "Cafe",
  "Bar",
  "Food Truck",
  "Diner",
  "Fine Dining",
  "Retail",
  "Enterprise / Multi-outlet",
]

const languageTag = {
  bm: "BM",
  en: "EN",
} as const

export type DemoFormVariant = "whatsapp" | "web"

// WhatsApp entries are submitted from the mobile-oriented form; the plain web
// form is the desktop entry point. The value is stored in the lead `source`
// using the canonical labels (web | mobile | manual).
const sourceByVariant: Record<DemoFormVariant, string> = {
  whatsapp: "mobile",
  web: "web",
}

const copy = {
  bm: {
    language: {
      hint: "Tukar bahasa",
      toggleLabel: "Tukar bahasa",
    },
    fields: {
      name: "Nama",
      phone: "Nombor Telefon",
      businessType: "Jenis Perniagaan",
      businessLocation: "Lokasi Perniagaan",
      businessTypePlaceholder: "Pilih Jenis",
    },
    placeholders: {
      name: "Nama",
      phone: "Nombor telefon anda",
      businessLocation: "Lokasi",
    },
    messages: {
      genericError: "Sesuatu yang tidak kena.",
      recaptchaMissing:
        "reCAPTCHA belum dikonfigurasi. Tetapkan NEXT_PUBLIC_RECAPTCHA_SITE_KEY dan RECAPTCHA_SECRET_KEY untuk mengaktifkan penghantaran.",
    },
    variants: {
      whatsapp: {
        header: {
          title: "Hantar mesej kepada Slurp! melalui WhatsApp",
          subtitle:
            "Selepas penghantaran, anda akan dialihkan ke WhatsApp untuk melengkapkan tempahan demo.",
        },
        submit: "Hantar ke WhatsApp",
        submitting: "Menghantar...",
        disclaimer:
          'Dengan klik "Hantar ke WhatsApp" anda bersetuju untuk memulakan perbualan WhatsApp dengan pasukan kami.',
        success: "Dihantar. Membuka WhatsApp...",
        missingWhatsapp: "Pautan WhatsApp tidak tersedia.",
      },
      web: {
        header: {
          title: "Tempah demo percuma",
          subtitle:
            "Lengkapkan butiran di bawah dan pasukan kami akan menghubungi anda tidak lama lagi.",
        },
        submit: "Hantar",
        submitting: "Menghantar...",
        disclaimer:
          "Dengan menghantar borang ini, anda bersetuju untuk dihubungi oleh pasukan kami.",
        success: "Terima kasih! Pasukan kami akan menghubungi anda tidak lama lagi.",
      },
    },
  },
  en: {
    language: {
      hint: "Change language",
      toggleLabel: "Change language",
    },
    fields: {
      name: "Name",
      phone: "Phone Number",
      businessType: "Business Type",
      businessLocation: "Business Location",
      businessTypePlaceholder: "Select Type",
    },
    placeholders: {
      name: "Name",
      phone: "Your phone number",
      businessLocation: "Location",
    },
    messages: {
      genericError: "Something went wrong.",
      recaptchaMissing:
        "reCAPTCHA is not configured. Set NEXT_PUBLIC_RECAPTCHA_SITE_KEY and RECAPTCHA_SECRET_KEY to enable submissions.",
    },
    variants: {
      whatsapp: {
        header: {
          title: "Send a message to Slurp! via WhatsApp",
          subtitle:
            "After submitting, you will be redirected to WhatsApp to complete your demo booking.",
        },
        submit: "Submit to WhatsApp",
        submitting: "Submitting...",
        disclaimer:
          'By clicking "Submit to WhatsApp" you agree to start a WhatsApp conversation with our team.',
        success: "Submitted. Opening WhatsApp...",
        missingWhatsapp: "WhatsApp link is unavailable.",
      },
      web: {
        header: {
          title: "Book a free demo",
          subtitle:
            "Fill in the details below and our team will get in touch with you shortly.",
        },
        submit: "Submit",
        submitting: "Submitting...",
        disclaimer: "By submitting this form, you agree to be contacted by our team.",
        success: "Thank you! Our team will be in touch with you shortly.",
      },
    },
  },
} as const

type FormAlert = {
  message: string
  variant: "success" | "error" | null
}

export default function DemoForm({ variant }: { variant: DemoFormVariant }) {
  const recaptchaSiteKey = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY
  const recaptchaEnabled = Boolean(recaptchaSiteKey && recaptchaSiteKey.trim())
  const isWhatsapp = variant === "whatsapp"

  const [submitting, setSubmitting] = React.useState(false)
  const [alert, setAlert] = React.useState<FormAlert>({ message: "", variant: null })
  const [language, setLanguage] = React.useState<keyof typeof copy>("bm")

  const t = copy[language]
  const v = t.variants[variant]

  const recaptchaError = recaptchaEnabled ? "" : t.messages.recaptchaMissing
  const submitLabel = submitting ? v.submitting : v.submit

  const getRecaptchaToken = async () => {
    if (!recaptchaSiteKey) {
      throw new Error("reCAPTCHA is not configured")
    }

    const grecaptcha = (
      window as Window & {
        grecaptcha?: {
          ready: (callback: () => void) => void
          execute: (siteKey: string, options: { action: string }) => Promise<string>
        }
      }
    ).grecaptcha

    if (!grecaptcha?.ready || !grecaptcha?.execute) {
      throw new Error("reCAPTCHA is not ready")
    }

    return new Promise<string>((resolve, reject) => {
      grecaptcha.ready(() => {
        void grecaptcha
          .execute(recaptchaSiteKey, { action: "demo_form" })
          .then((token) => resolve(String(token)))
          .catch((error) => reject(error))
      })
    })
  }

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (submitting) {
      return
    }

    setSubmitting(true)
    setAlert({ message: "", variant: null })

    try {
      const form = event.currentTarget
      const formData = new FormData(form)

      if (recaptchaEnabled) {
        const token = await getRecaptchaToken()
        if (!token) {
          throw new Error("Unable to verify reCAPTCHA.")
        }
        formData.set("g-recaptcha-response", token)
      }

      const response = await fetch("/api/leads", {
        method: "POST",
        body: formData,
      })

      const responseText = await response.text()
      let payload: { whatsappUrl?: string; error?: string; errors?: string[] } | null = null
      if (responseText) {
        try {
          payload = JSON.parse(responseText) as {
            whatsappUrl?: string
            error?: string
            errors?: string[]
          }
        } catch {
          payload = null
        }
      }

      if (!response.ok) {
        if (Array.isArray(payload?.errors)) {
          throw new Error(payload.errors.join(", "))
        }
        if (typeof payload?.error === "string" && payload.error.trim().length > 0) {
          throw new Error(payload.error)
        }
        throw new Error(responseText.trim() || "Submission failed")
      }

      const dataLayer = ((window as Window & { dataLayer?: Record<string, unknown>[] }).dataLayer ??=
        [])
      dataLayer.push({
        event: "demo_form_submit",
        form_id: "demo-form",
        source: sourceByVariant[variant],
        business_type: String(formData.get("business_type") ?? ""),
        language,
      })

      setAlert({ message: v.success, variant: "success" })
      form.reset()

      if (isWhatsapp) {
        const whatsappUrl =
          typeof payload?.whatsappUrl === "string" && payload.whatsappUrl.length
            ? payload.whatsappUrl
            : null

        window.setTimeout(() => {
          if (whatsappUrl) {
            window.location.href = whatsappUrl
            return
          }
          setAlert({ message: t.variants.whatsapp.missingWhatsapp, variant: "error" })
        }, 500)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : t.messages.genericError
      setAlert({ message, variant: "error" })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className={styles.page}>
      {recaptchaEnabled ? (
        <Script
          src={`https://www.google.com/recaptcha/api.js?render=${encodeURIComponent(
            recaptchaSiteKey ?? ""
          )}`}
          strategy="afterInteractive"
        />
      ) : null}
      <div className={styles.card}>
        <header className={styles.header}>
          <div className={styles.brandRow}>
            <Image
              src="/slurp-logo-basic-03.png"
              alt="Slurp!"
              width={96}
              height={28}
              className={styles.brandLogo}
              priority
            />
            <div className={styles.languageSwitcher}>
              <span className={styles.languageHint}>{t.language.hint}</span>
              <div
                className={styles.languageButton}
                role="group"
                aria-label={t.language.toggleLabel}
                title={t.language.toggleLabel}
              >
                <button
                  type="button"
                  className={language === "bm" ? styles.languageOptionActive : styles.languageOptionInactive}
                  onClick={() => setLanguage("bm")}
                  aria-pressed={language === "bm"}
                >
                  {languageTag.bm}
                </button>
                <span className={styles.languageDivider}>|</span>
                <button
                  type="button"
                  className={language === "en" ? styles.languageOptionActive : styles.languageOptionInactive}
                  onClick={() => setLanguage("en")}
                  aria-pressed={language === "en"}
                >
                  {languageTag.en}
                </button>
              </div>
            </div>
          </div>

          {isWhatsapp ? (
            <div className={styles.whatsappBadge} aria-hidden="true">
              <svg
                className={styles.whatsappIcon}
                viewBox="0 0 24 24"
                role="presentation"
                focusable="false"
              >
                <path
                  fill="currentColor"
                  d="M12 2C6.48 2 2 6.25 2 11.5c0 1.95.62 3.76 1.67 5.25L2 22l5.45-1.43c1.39.79 3 .93 4.55.93 5.52 0 10-4.25 10-9.5S17.52 2 12 2zm0 17c-1.35 0-2.62-.3-3.74-.86l-.27-.13-3.24.85.86-3.05-.18-.29A7.45 7.45 0 0 1 4.5 11.5C4.5 7.36 8 4 12 4s7.5 3.36 7.5 7.5S16 19 12 19zm3.78-5.21c-.2-.1-1.17-.57-1.35-.63-.18-.06-.31-.1-.44.1-.13.2-.5.63-.61.76-.11.13-.23.15-.42.05-.2-.1-.84-.31-1.6-.98-.59-.52-.99-1.17-1.1-1.37-.11-.2-.01-.31.09-.41.09-.09.2-.23.3-.34.1-.11.13-.19.2-.32.06-.13.03-.24-.02-.34-.06-.1-.44-1.06-.6-1.45-.16-.38-.32-.33-.44-.33h-.38c-.13 0-.34.05-.52.24-.18.2-.68.66-.68 1.6 0 .94.7 1.85.8 1.98.1.13 1.37 2.09 3.33 2.93.47.2.84.31 1.12.4.47.15.9.13 1.24.08.38-.06 1.17-.48 1.34-.94.17-.46.17-.85.12-.94-.05-.09-.18-.15-.38-.25z"
                />
              </svg>
            </div>
          ) : null}

          <h1 className={styles.title}>{v.header.title}</h1>
          <p className={styles.subtitle}>{v.header.subtitle}</p>
        </header>

        <div className={styles.body}>
          {!recaptchaEnabled ? (
            <div className={`${styles.alert} ${styles.error}`}>{t.messages.recaptchaMissing}</div>
          ) : null}
          <form id="demo-form" className={styles.form} onSubmit={onSubmit}>
            <input type="hidden" name="source" value={sourceByVariant[variant]} />
            <div className={styles.honeypot} aria-hidden="true">
              <label htmlFor="company_site">Company Site</label>
              <input id="company_site" name="company_site" tabIndex={-1} autoComplete="off" />
            </div>

            <div className={styles.fieldGroup}>
              <label htmlFor="name">
                {t.fields.name} <span className={styles.required}>*</span>
              </label>
              <input id="name" name="name" required placeholder={t.placeholders.name} />
            </div>

            <div className={styles.fieldGroup}>
              <label htmlFor="telephone">
                {t.fields.phone} <span className={styles.required}>*</span>
              </label>
              <input
                id="telephone"
                name="telephone"
                type="tel"
                inputMode="numeric"
                pattern="[0-9]*"
                required
                placeholder={t.placeholders.phone}
                onInput={(event) => {
                  event.currentTarget.value = event.currentTarget.value.replace(/\D/g, "")
                }}
              />
            </div>

            <div className={styles.fieldGroup}>
              <label htmlFor="business_type">
                {t.fields.businessType} <span className={styles.required}>*</span>
              </label>
              <select id="business_type" name="business_type" required defaultValue="">
                <option value="" disabled>
                  {t.fields.businessTypePlaceholder}
                </option>
                {businessTypes.map((businessType) => (
                  <option key={businessType} value={businessType}>
                    {businessType}
                  </option>
                ))}
              </select>
            </div>

            <div className={styles.fieldGroup}>
              <label htmlFor="business_location">
                {t.fields.businessLocation} <span className={styles.required}>*</span>
              </label>
              <input
                id="business_location"
                name="business_location"
                required
                placeholder={t.placeholders.businessLocation}
              />
            </div>

            {alert.variant ? (
              <div className={`${styles.alert} ${styles[alert.variant]}`}>{alert.message}</div>
            ) : null}

            <div className={styles.actions}>
              <button
                type="submit"
                className={styles.submitButton}
                disabled={submitting || !recaptchaEnabled}
                title={recaptchaError || undefined}
              >
                {submitLabel}
              </button>
              <p className={styles.disclaimer}>{v.disclaimer}</p>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
