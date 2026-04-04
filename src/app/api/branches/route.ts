import { NextRequest, NextResponse } from "next/server"

import { requireAuthenticatedUser } from "@/lib/auth"
import getPool from "@/lib/db"
import {
  authenticatePosApi,
  fetchPosApiWithToken,
  getPosApiItems,
  isPosApiRecord,
  resolvePosBranchUrl,
} from "@/lib/pos-api"

type Branch = {
  id: string
  code: string | null
  name: string
  status: number | string | null
  group: string | null
  isPrimary: boolean
}

type MerchantBranchRow = {
  raw_payload: unknown
}

function toBranch(item: unknown): Branch | null {
  if (!isPosApiRecord(item)) {
    return null
  }

  const idValue = item.id ?? item.branch_id ?? item.code ?? item.name
  const nameValue = item.name ?? item.branch_name ?? item.code
  if (!idValue || !nameValue) {
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
    group:
      typeof item.remark === "string"
        ? item.remark
        : typeof item.group === "string"
          ? item.group
          : null,
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
      return JSON.parse(rawPayload) as Record<string, unknown>
    } catch {
      return null
    }
  }

  if (rawPayload && typeof rawPayload === "object" && !Array.isArray(rawPayload)) {
    return rawPayload as Record<string, unknown>
  }

  return null
}

function readStringCandidate(
  payload: Record<string, unknown> | null,
  keys: string[]
) {
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

function readScalarCandidate(
  payload: Record<string, unknown> | null,
  keys: string[]
) {
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

function readNestedRecord(
  payload: Record<string, unknown> | null,
  keys: string[]
) {
  if (!payload) {
    return null
  }

  for (const key of keys) {
    const value = payload[key]
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>
    }
  }

  return null
}

function normalizeText(value: string | null) {
  return value?.trim().toLowerCase() ?? ""
}

function getBranchFromMerchantPayload(rawPayload: unknown): Branch | null {
  const payload = parsePayload(rawPayload)
  const nestedBranch = readNestedRecord(payload, ["branch", "branch_info", "cloud_branch"])
  const id =
    readScalarCandidate(payload, ["branch_id", "branchId"]) ??
    readScalarCandidate(nestedBranch, ["id", "branch_id", "branchId", "code"])
  const name =
    readStringCandidate(payload, ["branch_name", "branchName"]) ??
    readStringCandidate(nestedBranch, ["name", "branch_name", "branchName", "code"])

  if (!id || !name) {
    return null
  }

  const code =
    readStringCandidate(payload, ["branch_code", "branchCode"]) ??
    readStringCandidate(nestedBranch, ["code", "branch_code", "branchCode"])

  return {
    id,
    code,
    name,
    status: readScalarCandidate(nestedBranch, ["status", "state"]),
    group:
      readStringCandidate(payload, ["branch_group", "branchGroup", "remark"]) ??
      readStringCandidate(nestedBranch, ["remark", "group", "branch_group"]),
    isPrimary:
      normalizeText(readScalarCandidate(nestedBranch, ["is_primary", "isPrimary"])) === "1" ||
      normalizeText(readScalarCandidate(nestedBranch, ["is_primary", "isPrimary"])) === "true",
  }
}

async function loadLocalBranches() {
  const pool = getPool()
  const [rows] = await pool.query(
    `
    SELECT raw_payload
    FROM merchants
    WHERE raw_payload IS NOT NULL
  `
  )

  const branchMap = new Map<string, Branch>()

  for (const row of rows as MerchantBranchRow[]) {
    const branch = getBranchFromMerchantPayload(row.raw_payload)
    if (!branch) {
      continue
    }

    const key = `${branch.id}::${branch.name}`
    if (!branchMap.has(key)) {
      branchMap.set(key, branch)
    }
  }

  return Array.from(branchMap.values()).sort((left, right) => {
    const groupCompare = (left.group ?? "").localeCompare(right.group ?? "")
    if (groupCompare !== 0) {
      return groupCompare
    }
    return left.name.localeCompare(right.name)
  })
}

export async function GET(request: NextRequest) {
  const user = await requireAuthenticatedUser(request)
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 })
  }

  try {
    const token = await authenticatePosApi()
    const url = new URL(resolvePosBranchUrl())
    const response = await fetchPosApiWithToken(url, token)

    if (!response.ok) {
      const details = await response.text().catch(() => "")
      return NextResponse.json(
        {
          error: details
            ? `Unable to load branches: ${details}`
            : "Unable to load branches.",
        },
        { status: response.status }
      )
    }

    const payload = await response.json()
    const branches = getPosApiItems(payload)
      .map((item) => toBranch(item))
      .filter((item): item is Branch => item !== null)
      .sort((left, right) => {
        const groupCompare = (left.group ?? "").localeCompare(right.group ?? "")
        if (groupCompare !== 0) {
          return groupCompare
        }
        return left.name.localeCompare(right.name)
      })

    return NextResponse.json({ branches })
  } catch (error) {
    console.error(error)
    try {
      const branches = await loadLocalBranches()
      return NextResponse.json({ branches, source: "local-fallback" })
    } catch (fallbackError) {
      console.error(fallbackError)
      return NextResponse.json(
        { error: "Unable to load branches." },
        { status: 500 }
      )
    }
  }
}
