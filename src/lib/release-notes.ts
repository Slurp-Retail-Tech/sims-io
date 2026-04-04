import fs from "fs"
import path from "path"

import matter from "gray-matter"

const CONTENT_DIR = path.join(
  process.cwd(),
  "src/app/(app)/release-notes/content"
)

export type ReleaseNoteItem = {
  title: string
  detail: string
}

export type ReleaseNote = {
  version: string
  date: string
  title: string
  summary: string
  improved: ReleaseNoteItem[]
  fixed: ReleaseNoteItem[]
  breaking_changes: string
}

function parseFile(filename: string): ReleaseNote {
  const raw = fs.readFileSync(path.join(CONTENT_DIR, filename), "utf8")
  const { data } = matter(raw)
  return data as ReleaseNote
}

function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number)
  const pb = b.split(".").map(Number)
  for (let i = 0; i < 3; i++) {
    const diff = (pb[i] ?? 0) - (pa[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

export function getAllReleaseNotes(): ReleaseNote[] {
  const files = fs.readdirSync(CONTENT_DIR).filter((f) => f.endsWith(".md"))
  return files
    .map((f) => parseFile(f))
    .sort((a, b) => compareVersions(a.version, b.version))
}

export function getReleaseNote(version: string): ReleaseNote | null {
  const filename = `${version}.md`
  const filepath = path.join(CONTENT_DIR, filename)
  if (!fs.existsSync(filepath)) return null
  return parseFile(filename)
}
