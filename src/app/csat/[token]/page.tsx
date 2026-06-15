"use client"

import * as React from "react"
import { useParams } from "next/navigation"
import { Moon, Sun } from "lucide-react"
import { useTheme } from "next-themes"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"

type SurveyPayload = {
  status: "active" | "expired" | "submitted"
  ticket: {
    id: string
    merchantName: string | null
    phoneNumber: string | null
    franchiseName: string | null
    outletName: string | null
  }
  token: {
    createdAt: string
    expiresAt: string
    usedAt: string | null
    submittedAt: string | null
  }
  googleReview?: {
    url: string | null
  }
}

type Language = "en" | "bm"

const copy = {
  en: {
    langLabel: "English",
    title: "We appreciate your feedback",
    subtitle:
      "Dear {merchantName}, thank you for reaching out to Slurp Support. Please take a minute to tell us how the interaction went so we can keep improving.",
    letterHeading: "Dear Valued Customer,",
    letterBody:
      "Thank you for contacting our Slurp Support. Appreciate you to share your experience with us today.",
    q1: "How satisfied are you with Slurp Support?",
    q1Prompt: "Please let us know the reason if you're dissatisfied:",
    q2: "How satisfied are you with the Slurp Product overall?",
    q2Prompt: "Please share how we can improve our product:",
    ratings: ["Very Satisfied", "Satisfied", "Neutral", "Dissatisfied"],
    invalidTitle: "Link unavailable.",
    invalidBody:
      "This CSAT link is invalid or has been revoked. Please reach out to your Slurp Support representative.",
    expiredTitle: "This link has expired.",
    expiredBody:
      "CSAT links are valid for 3 days after a ticket is resolved. Please request a fresh link from our team.",
    submittedTitle: "Thank you for your valuable feedback.",
    submittedBody:
      "We’ve recorded your responses and the team will review them to keep improving Slurp Support and product experience.",
    reviewTitle: "Enjoyed your experience?",
    reviewBody:
      "We’d be grateful if you could share a quick public review of Slurp Retail Tech on Google.",
    reviewButton: "Leave a Google review",
    submitButton: "Submit Feedback",
    submitting: "Submitting...",
    requiredError: "Please complete both ratings before submitting.",
    submitError: "Unable to submit feedback. Please try again.",
    footer: "Thank you again for your valuable feedback.",
    loading: "Loading survey...",
  },
  bm: {
    langLabel: "Bahasa Melayu",
    title: "Kami menghargai maklum balas anda",
    subtitle:
      "Pelanggan yang dihormati {merchantName}, terima kasih kerana menghubungi Slurp Support. Sila luangkan masa untuk berkongsi pengalaman anda supaya kami boleh terus menambah baik.",
    letterHeading: "Pelanggan yang dihormati,",
    letterBody:
      "Terima kasih kerana menghubungi Slurp Support kami. Menghargai anda untuk berkongsi pengalaman anda dengan kami hari ini.",
    q1: "Sejauh manakah anda berpuas hati dengan Slurp Support?",
    q1Prompt: "Sila beritahu kami sebabnya jika anda tidak berpuas hati:",
    q2: "Sejauh manakah anda berpuas hati dengan Produk Slurp secara keseluruhan?",
    q2Prompt: "Sila kongsi bagaimana kami boleh menambah baik produk kami:",
    ratings: [
      "Sangat Puas Hati",
      "Puas hati",
      "Berkecuali",
      "Tidak berpuas hati",
    ],
    invalidTitle: "Pautan tidak tersedia.",
    invalidBody:
      "Pautan CSAT ini tidak sah atau telah dibatalkan. Sila hubungi wakil Slurp Support anda.",
    expiredTitle: "Pautan ini telah tamat tempoh.",
    expiredBody:
      "Pautan CSAT sah untuk 3 hari selepas tiket diselesaikan. Sila minta pautan baharu daripada pasukan kami.",
    submittedTitle: "Terima kasih atas maklum balas anda yang berharga.",
    submittedBody:
      "Kami telah merekod maklum balas anda dan pasukan akan menelitinya untuk terus menambah baik Slurp Support dan pengalaman produk.",
    reviewTitle: "Berpuas hati dengan pengalaman anda?",
    reviewBody:
      "Kami amat menghargai jika anda sudi berkongsi ulasan ringkas mengenai Slurp Retail Tech di Google.",
    reviewButton: "Tinggalkan ulasan Google",
    submitButton: "Hantar Maklum Balas",
    submitting: "Menghantar...",
    requiredError: "Sila lengkapkan kedua-dua penilaian sebelum hantar.",
    submitError: "Tidak dapat menghantar maklum balas. Sila cuba lagi.",
    footer: "Terima kasih sekali lagi atas maklum balas anda yang berharga.",
    loading: "Memuatkan tinjauan...",
  },
} as const

const ratingEmojis = ["☺️", "😊", "😐", "☹️"]

export default function CsatSurveyPage() {
  const params = useParams<{ token: string }>()
  const token = typeof params?.token === "string" ? params.token : ""
  const { resolvedTheme, setTheme } = useTheme()

  const [mounted, setMounted] = React.useState(false)
  const [language, setLanguage] = React.useState<Language>("en")
  const [loading, setLoading] = React.useState(true)
  const [submitting, setSubmitting] = React.useState(false)
  const [invalidLink, setInvalidLink] = React.useState(false)
  const [payload, setPayload] = React.useState<SurveyPayload | null>(null)
  const [supportScore, setSupportScore] = React.useState("")
  const [productScore, setProductScore] = React.useState("")
  const [supportReason, setSupportReason] = React.useState("")
  const [productFeedback, setProductFeedback] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const text = copy[language]
  const pageContainerClass = "relative mx-auto min-h-svh w-full max-w-6xl overflow-hidden px-4"

  const loadSurvey = React.useCallback(async () => {
    if (!token) {
      setInvalidLink(true)
      setLoading(false)
      return
    }
    setLoading(true)
    setInvalidLink(false)
    try {
      const response = await fetch(`/api/csat/${encodeURIComponent(token)}`)
      if (!response.ok) {
        if (response.status === 404) {
          setInvalidLink(true)
          setPayload(null)
          setError(null)
          return
        }
        throw new Error("Unable to open CSAT survey.")
      }
      const data = (await response.json()) as SurveyPayload
      setPayload(data)
      setError(null)
    } catch {
      setError("Unable to open CSAT survey.")
    } finally {
      setLoading(false)
    }
  }, [token])

  React.useEffect(() => {
    void loadSurvey()
  }, [loadSurvey])

  React.useEffect(() => {
    setMounted(true)
  }, [])

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!token || !supportScore || !productScore) {
      setError(text.requiredError)
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const response = await fetch(`/api/csat/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supportScore,
          supportReason: supportReason.trim() || null,
          productScore,
          productFeedback: productFeedback.trim() || null,
        }),
      })
      if (!response.ok) {
        await loadSurvey()
        throw new Error("Unable to submit feedback.")
      }
      await loadSurvey()
    } catch {
      setError(text.submitError)
    } finally {
      setSubmitting(false)
    }
  }

  const handleReviewClick = () => {
    if (!token) {
      return
    }
    // Fire-and-forget: record the click but never block opening the review page.
    void fetch(`/api/csat/${encodeURIComponent(token)}/review-click`, {
      method: "POST",
      keepalive: true,
    }).catch(() => {})
  }

  if (loading) {
    return (
      <main className={`${pageContainerClass} py-12`}>
        <p className="text-sm text-muted-foreground">{text.loading}</p>
      </main>
    )
  }

  if (invalidLink) {
    return (
      <main className={`${pageContainerClass} py-8`}>
        <Card>
          <CardHeader>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setTheme(
                    mounted && resolvedTheme === "dark" ? "light" : "dark"
                  )
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
                onClick={() => setLanguage("en")}
              >
                EN
              </Button>
              <Button
                variant={language === "bm" ? "default" : "outline"}
                size="sm"
                onClick={() => setLanguage("bm")}
              >
                BM
              </Button>
            </div>
            <CardTitle>{text.invalidTitle}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">{text.invalidBody}</p>
            <p className="text-sm font-medium">{text.footer}</p>
          </CardContent>
        </Card>
      </main>
    )
  }

  if (!payload) {
    return null
  }

  const merchantName = payload.ticket.merchantName ?? "Merchant"
  const subtitleParts = text.subtitle.split("{merchantName}")
  const ratingOptions = text.ratings

  return (
    <main className={`${pageContainerClass} py-8`}>
      <Card>
        <CardHeader>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
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
              onClick={() => setLanguage("en")}
            >
              EN
            </Button>
            <Button
              variant={language === "bm" ? "default" : "outline"}
              size="sm"
              onClick={() => setLanguage("bm")}
            >
              BM
            </Button>
          </div>
          <CardTitle>{text.title}</CardTitle>
          <p className="text-sm text-muted-foreground">
            {subtitleParts[0]}
            <strong>{merchantName}</strong>
            {subtitleParts[1] ?? ""}
          </p>
          <p className="text-sm">{text.letterHeading}</p>
          <p className="text-sm text-muted-foreground">{text.letterBody}</p>
          <p className="text-xs text-muted-foreground">
            Ticket #{payload.ticket.id} · {payload.ticket.franchiseName ?? "--"} ·{" "}
            {payload.ticket.outletName ?? "--"}
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {payload.status === "submitted" ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <p className="text-sm font-medium text-emerald-700">{text.submittedTitle}</p>
                <p className="text-sm text-muted-foreground">{text.submittedBody}</p>
              </div>
              {payload.googleReview?.url ? (
                <div className="space-y-2 rounded-md border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900 dark:bg-emerald-950/40">
                  <p className="text-sm font-medium">{text.reviewTitle}</p>
                  <p className="text-sm text-muted-foreground">{text.reviewBody}</p>
                  <Button asChild>
                    <a
                      href={payload.googleReview.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={handleReviewClick}
                    >
                      {text.reviewButton}
                    </a>
                  </Button>
                </div>
              ) : null}
            </div>
          ) : payload.status === "expired" ? (
            <div className="space-y-2">
              <p className="text-sm font-medium text-rose-600">{text.expiredTitle}</p>
              <p className="text-sm text-muted-foreground">{text.expiredBody}</p>
            </div>
          ) : (
            <form className="space-y-4" onSubmit={handleSubmit}>
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">{text.q1}</legend>
                <div className="flex flex-wrap gap-2">
                  {ratingOptions.map((label, index) => (
                    <Button
                      key={`support-${label}`}
                      type="button"
                      variant={supportScore === label ? "default" : "outline"}
                      size="sm"
                      onClick={() => setSupportScore(label)}
                    >
                      <span className="inline-flex items-center gap-2">
                        <span aria-hidden="true">{ratingEmojis[index] ?? "•"}</span>
                        <span>{label}</span>
                      </span>
                    </Button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">{text.q1Prompt}</p>
                <textarea
                  className="border-input focus-visible:ring-ring/50 min-h-24 w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-[3px]"
                  value={supportReason}
                  onChange={(event) => setSupportReason(event.target.value)}
                />
              </fieldset>

              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">{text.q2}</legend>
                <div className="flex flex-wrap gap-2">
                  {ratingOptions.map((label, index) => (
                    <Button
                      key={`product-${label}`}
                      type="button"
                      variant={productScore === label ? "default" : "outline"}
                      size="sm"
                      onClick={() => setProductScore(label)}
                    >
                      <span className="inline-flex items-center gap-2">
                        <span aria-hidden="true">{ratingEmojis[index] ?? "•"}</span>
                        <span>{label}</span>
                      </span>
                    </Button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">{text.q2Prompt}</p>
                <textarea
                  className="border-input focus-visible:ring-ring/50 min-h-24 w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-[3px]"
                  value={productFeedback}
                  onChange={(event) => setProductFeedback(event.target.value)}
                />
              </fieldset>

              <Button type="submit" disabled={submitting}>
                {submitting ? text.submitting : text.submitButton}
              </Button>
            </form>
          )}

          {error ? <p className="text-sm text-rose-600">{error}</p> : null}
          <p className="text-sm font-medium">{text.footer}</p>
        </CardContent>
      </Card>
    </main>
  )
}
