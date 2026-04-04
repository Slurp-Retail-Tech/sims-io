import type { Metadata } from "next"
import Link from "next/link"
import { Tag } from "lucide-react"

import { getAllReleaseNotes } from "@/lib/release-notes"
import { Card, CardContent } from "@/components/ui/card"

export const metadata: Metadata = {
  title: "Release Notes",
}

export default function ReleaseNotesPage() {
  const releases = getAllReleaseNotes()

  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Release Notes</h1>
        <p className="text-muted-foreground text-sm">
          A history of changes, improvements, and fixes.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {releases.map((release, index) => (
          <Link
            key={release.version}
            href={`/release-notes/${release.version}`}
            className="group block"
          >
            <Card className="transition-colors group-hover:bg-accent/50">
              <CardContent className="flex items-center justify-between gap-4 py-4">
                <div className="flex items-center gap-3">
                  <Tag className="text-muted-foreground size-4 shrink-0" />
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold">
                        v{release.version}
                      </span>
                      {index === 0 && (
                        <span className="inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium text-muted-foreground">
                          Latest
                        </span>
                      )}
                    </div>
                    <p className="text-muted-foreground text-xs">
                      {release.title}
                    </p>
                  </div>
                </div>
                <span className="text-muted-foreground text-xs tabular-nums">
                  {release.date}
                </span>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  )
}
