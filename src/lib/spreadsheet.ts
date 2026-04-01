import { Workbook } from "exceljs"

function normalizeCell(value: string | number | null | undefined) {
  return value ?? ""
}

function escapeCsvCell(value: string) {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

export async function workbookToBuffer(
  sheetName: string,
  rows: Array<Array<string | number | null | undefined>>
) {
  const workbook = new Workbook()
  const worksheet = workbook.addWorksheet(sheetName)

  for (const row of rows) {
    worksheet.addRow(row.map((value) => normalizeCell(value)))
  }

  const buffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(buffer)
}

export function rowsToCsv(
  rows: Array<Array<string | number | null | undefined>>
) {
  return rows
    .map((row) =>
      row
        .map((value) => escapeCsvCell(String(normalizeCell(value))))
        .join(",")
    )
    .join("\n")
}

export async function readWorkbookRows(buffer: Buffer) {
  const workbook = new Workbook()
  const workbookBuffer = buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]
  await workbook.xlsx.load(workbookBuffer)

  const worksheet = workbook.worksheets[0]
  if (!worksheet) {
    throw new Error("Template does not contain any sheets.")
  }

  return worksheet.getSheetValues().slice(1).map((row) => {
    if (!Array.isArray(row)) {
      return []
    }

    return row.slice(1).map((value) => {
      if (value === null || value === undefined) {
        return ""
      }
      if (typeof value === "object") {
        if ("text" in value && typeof value.text === "string") {
          return value.text
        }
        if ("result" in value && value.result !== undefined) {
          return String(value.result)
        }
      }
      return String(value)
    })
  })
}
