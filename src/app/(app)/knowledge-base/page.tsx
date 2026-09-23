import type { Metadata } from "next"
import { BookOpen, CheckCircle2 } from "lucide-react"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  kbCategoryArticleCounts,
  kbPublishedArticles,
  validatePublishableArticle,
  type KbCategory,
  type KbNotionArticle,
} from "@/lib/knowledge-base"

export const metadata: Metadata = {
  title: "Knowledge Base",
}

const categories = Object.entries(kbCategoryArticleCounts).map(
  ([title, articles]) => ({
    title: title as KbCategory,
    articles,
  })
)

const queueCandidates: KbNotionArticle[] = [
  {
    title: "Ticket Statuses Explained",
    audience: "External User",
    category: "Tickets",
    featureArea: ["Tickets", "Merchant Success"],
    status: "Approved",
    appVersion: "v1.0.1",
    lastVerifiedDate: "2026-02-24",
    sourceRefs: ["/src/app/(app)/merchant-success/tickets/page.tsx"],
    owner: "Merchant Success Ops",
  },
  {
    // Draft text in docs/kb-drafts/renewals-staff-guide.md, for Notion.
    title: "Renewals: how the renewal flow works",
    audience: "External User",
    category: "Renewals",
    featureArea: ["Renewal & Retention"],
    status: "Draft",
    appVersion: "v4.35.1",
    lastVerifiedDate: "2026-09-23",
    sourceRefs: [
      "/docs/kb-drafts/renewals-staff-guide.md",
      "/src/lib/renewal/setup-checklist.ts",
      "/src/lib/renewal/cycle.ts",
      "/src/lib/renewal/settings-timeline.ts",
      "/docs/scheduler.md",
    ],
    owner: "Renewal Ops",
  },
]

export default function KnowledgeBasePage() {
  const publishQueue = queueCandidates
    .map((candidate) => ({
      candidate,
      validation: validatePublishableArticle(candidate),
    }))
    .filter((item) => item.validation.canPublish)

  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Knowledge Base</h1>
        <p className="text-muted-foreground text-sm">
          End-user reference for product features and usage guides.
        </p>
      </div>

      <Card>
        <CardHeader className="space-y-2">
          <CardTitle className="text-base">Search articles</CardTitle>
          <Input placeholder="Search by topic or keyword" />
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          {categories.map((category) => (
            <div
              key={category.title}
              className="rounded-xl border px-4 py-3"
            >
              <div className="flex items-center gap-2">
                <BookOpen className="text-muted-foreground size-4" />
                <span className="text-sm font-semibold">{category.title}</span>
              </div>
              <div className="text-muted-foreground text-xs">
                {category.articles} articles
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="space-y-2">
          <CardTitle className="text-base">Published articles</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          {kbPublishedArticles.map((article) => (
            <div key={article.slug} className="rounded-xl border px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold">{article.title}</p>
                <span className="text-muted-foreground text-xs">
                  {article.versionTag}
                </span>
              </div>
              <p className="text-muted-foreground mt-1 text-xs">{article.summary}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="space-y-2">
          <CardTitle className="text-base">Publish queue (Approved only)</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          {publishQueue.map(({ candidate }) => (
            <div key={candidate.title} className="rounded-xl border px-4 py-3">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="size-4 text-emerald-600" />
                <span className="text-sm font-semibold">{candidate.title}</span>
              </div>
              <p className="text-muted-foreground mt-1 text-xs">
                {candidate.category} · Verified {candidate.lastVerifiedDate}
              </p>
            </div>
          ))}
          {publishQueue.length === 0 ? (
            <p className="text-muted-foreground text-xs">
              No approved articles are ready for publication.
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}
