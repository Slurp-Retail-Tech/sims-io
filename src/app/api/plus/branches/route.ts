import { NextRequest, NextResponse } from "next/server"

import getPool from "@/lib/db"
import {
  authenticatePosApi,
  fetchPosApiWithToken,
  getPosApiItems,
  isPosApiRecord,
  resolvePosBranchUrl,
} from "@/lib/pos-api"
import { requireAuthenticatedUser } from "@/lib/auth"

type BranchOption = {
  id: string
  code: string | null
  name: string
  group: string | null
  status: number | string | null
  isPrimary: boolean
}

type MerchantPayload = Record<string, unknown>
type MerchantRow = {
  raw_payload: unknown
}

function normalizeText(value: string | null) {
  return value?.trim().toLowerCase() ?? ""
}

function toBranchOption(item: unknown): BranchOption | null {
  if (!isPosApiRecord(item)) {
    return null
  }

  const idValue = item.id ?? item.branch_id ?? item.code ?? item.name
  const nameValue = item.name ?? item.branch_name ?? item.code
  if (!idValue || !nameValue) {
    return null
  }

  const group =
    typeof item.remark === "string"
      ? item.remark.trim()
      : typeof item.group === "string"
        ? item.group.trim()
        : null

  if (normalizeText(group) !== "plus") {
    return null
  }

  const statusValue = item.status ?? item.state ?? null
  const isPrimaryValue = item.is_primary ?? item.isPrimary ?? 0

  return {
    id: String(idValue),
    code: typeof item.code === "string" ? item.code : null,
    name: String(nameValue),
    status:
      typeof statusValue === "number" || typeof statusValue === "string"
        ? statusValue
        : null,
    group,
    isPrimary:
      isPrimaryValue === true ||
      isPrimaryValue === 1 ||
      isPrimaryValue === "1" ||
      isPrimaryValue === "true",
  }
}

function parsePayload(rawPayload: unknown) {
  if (typeof rawPayload === "string") {
    try {
      return JSON.parse(rawPayload) as MerchantPayload
    } catch {
      return null
    }
  }

  if (rawPayload && typeof rawPayload === "object" && !Array.isArray(rawPayload)) {
    return rawPayload as MerchantPayload
  }

  return null
}

function readStringCandidate(payload: MerchantPayload | null, keys: string[]) {
  if (!payload) {
    return null
  }

  for (const key of keys) {
    const value = payload[key]
    if (typeof value === "string" && value.trim()) {
      return value.trim()
    }
  }

  return null
}

function readScalarCandidate(payload: MerchantPayload | null, keys: string[]) {
  if (!payload) {
    return null
  }

  for (const key of keys) {
    const value = payload[key]
    if (typeof value === "string" && value.trim()) {
      return value.trim()
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value)
    }
  }

  return null
}

function readNestedRecord(payload: MerchantPayload | null, keys: string[]) {
  if (!payload) {
    return null
  }

  for (const key of keys) {
    const value = payload[key]
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as MerchantPayload
    }
  }

  return null
}

function toFallbackBranchOption(rawPayload: unknown): BranchOption | null {
  const payload = parsePayload(rawPayload)
  const nestedBranch = readNestedRecord(payload, ["branch", "branch_info", "cloud_branch"])
  const group =
    readStringCandidate(payload, ["branch_group", "branchGroup", "remark"]) ??
    readStringCandidate(nestedBranch, ["remark", "group", "branch_group"])

  if (normalizeText(group) !== "plus") {
    return null
  }

  const id =
    readScalarCandidate(payload, ["branch_id", "branchId"]) ??
    readScalarCandidate(nestedBranch, ["id", "branch_id", "branchId", "code"])
  const name =
    readStringCandidate(payload, ["branch_name", "branchName"]) ??
    readStringCandidate(nestedBranch, ["name", "branch_name", "branchName"]) ??
    readStringCandidate(payload, ["branch_code", "branchCode"]) ??
    readStringCandidate(nestedBranch, ["code", "branch_code", "branchCode"])

  if (!id || !name) {
    return null
  }

  const statusValue =
    readScalarCandidate(nestedBranch, ["status", "state"]) ??
    readScalarCandidate(payload, ["branch_status", "branchStatus"])

  return {
    id,
    code:
      readStringCandidate(payload, ["branch_code", "branchCode"]) ??
      readStringCandidate(nestedBranch, ["code", "branch_code", "branchCode"]),
    name,
    group,
    status: statusValue,
    isPrimary:
      readScalarCandidate(nestedBranch, ["is_primary", "isPrimary"]) === "1" ||
      readScalarCandidate(nestedBranch, ["is_primary", "isPrimary"]) === "true",
  }
}

function sortBranches(branches: BranchOption[]) {
  return branches.sort((left, right) => left.name.localeCompare(right.name))
}

async function loadFallbackBranches() {
  const pool = getPool()
  const [rows] = await pool.query(
    `
    SELECT raw_payload
    FROM merchants
    WHERE raw_payload IS NOT NULL
  `
  )

  const branchMap = new Map<string, BranchOption>()

  for (const row of rows as MerchantRow[]) {
    const option = toFallbackBranchOption(row.raw_payload)
    if (!option) {
      continue
    }

    const key = `${option.id}::${option.name}`
    if (!branchMap.has(key)) {
      branchMap.set(key, option)
    }
  }

  return sortBranches(Array.from(branchMap.values()))
}

export async function GET(request: NextRequest) {
  const user = await requireAuthenticatedUser(request)
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 })
  }

  try {
    const token = await authenticatePosApi()
    const response = await fetchPosApiWithToken(new URL(resolvePosBranchUrl()), token)

    if (!response.ok) {
      throw new Error(`Unable to load branches (${response.status}).`)
    }

    const payload = await response.json()
    const branches = sortBranches(
      getPosApiItems(payload)
        .map((item) => toBranchOption(item))
        .filter((item): item is BranchOption => item !== null)
    )

    return NextResponse.json({ branches })
  } catch (error) {
    console.error(error)

    try {
      const branches = await loadFallbackBranches()
      return NextResponse.json({ branches, source: "local-fallback" })
    } catch (fallbackError) {
      console.error(fallbackError)
      return NextResponse.json(
        { error: "Unable to load PLUS branches." },
        { status: 500 }
      )
    }
  }
}
