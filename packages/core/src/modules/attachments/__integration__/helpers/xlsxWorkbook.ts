type WorkbookValue = string | number | boolean | Date | null

export type WorkbookCell = WorkbookValue | { formula: string; formulaResult: WorkbookValue }

export type WorkbookSheet = {
  name: string
  rows: WorkbookCell[][]
}

export type WorkbookOptions = {
  inlineStrings?: boolean
  vbaProject?: Uint8Array
  password?: string
}

export async function buildWorkbook(sheets: WorkbookSheet[], options: WorkbookOptions = {}): Promise<Buffer> {
  const { writeXlsx } = await import('hucre/xlsx')
  const workbook = await writeXlsx({
    sheets,
    ...(options.inlineStrings ? { stringMode: 'inline' as const } : {}),
    ...(options.vbaProject ? { vbaProject: options.vbaProject } : {}),
    ...(options.password ? { encryption: { password: options.password, spinCount: 1_000 } } : {}),
  })
  return Buffer.from(workbook)
}
