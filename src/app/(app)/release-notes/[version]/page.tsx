import type { Metadata } from "next"
import { notFound } from "next/navigation"
import Link from "next/link"
import { ArrowUpCircle, Wrench, AlertTriangle, Info, ArrowLeft, Tag } from "lucide-react"

import { getReleaseNote, getAllReleaseNotes } from "@/lib/release-notes"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export async function generateMetadata({
  params,
}: {
  params: Promise<{ version: string }>
}): Promise<Metadata> {
  const { version } = await params
  const release = getReleaseNote(version)
  return {
    title: release ? `v${release.version} · ${release.title}` : `Release Notes`,
  }
}

export async function generateStaticParams() {
  return getAllReleaseNotes().map((r) => ({ version: r.version }))
}

export default async function ReleaseNoteDetailPage({
  params,
}: {
  params: Promise<{ version: string }>
}) {
  const { version } = await params
  const release = getReleaseNote(version)
  if (!release) notFound()

  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 flex flex-col gap-6">
      {/* Back link */}
      <Link
        href="/release-notes"
        className="text-muted-foreground hover:text-foreground flex w-fit items-center gap-1.5 text-sm transition-colors"
      >
        <ArrowLeft className="size-4" />
        All releases
      </Link>

      {/* Version header */}
      <Card>
        <CardContent className="flex items-center gap-3 py-4">
          <Tag className="text-muted-foreground size-5 shrink-0" />
          <div>
            <div className="flex items-center gap-2">
              <span className="text-lg font-semibold">v{release.version}</span>
            </div>
            <p className="text-muted-foreground text-xs">{release.date}</p>
          </div>
        </CardContent>
      </Card>

      {/* Summary */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Info className="text-muted-foreground size-4" />
            Summary
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm leading-relaxed">
          {release.summary}
        </CardContent>
      </Card>

      {/* Improved */}
      {release.improved?.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <ArrowUpCircle className="size-4 text-emerald-600 dark:text-emerald-400" />
              Improved
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-4">
              {release.improved.map((item) => (
                <li key={item.title} className="flex gap-3 text-sm">
                  <ArrowUpCircle className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                  <div>
                    <span className="font-medium">{item.title}</span>
                    {" — "}
                    <span className="text-muted-foreground">{item.detail}</span>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Fixed */}
      {release.fixed?.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Wrench className="size-4 text-amber-600 dark:text-amber-400" />
              Fixed
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-4">
              {release.fixed.map((item) => (
                <li key={item.title} className="flex gap-3 text-sm">
                  <Wrench className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
                  <div>
                    <span className="font-medium">{item.title}</span>
                    {" — "}
                    <span className="text-muted-foreground">{item.detail}</span>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Breaking Changes */}
      {release.breaking_changes && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="size-4 text-orange-600 dark:text-orange-400" />
              Breaking Changes
            </CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground text-sm leading-relaxed">
            {release.breaking_changes}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
