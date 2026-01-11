import * as XLSX from 'xlsx'

export interface ExcelParseResult {
  headers: string[]
  rows: any[][]
  metadata: {
    sheetName: string
    totalRows: number
    totalColumns: number
  }
}

export interface ParseOptions {
  maxRows?: number
  sheetIndex?: number
}

export class ExcelService {
  async parseFile(buffer: Buffer, options: ParseOptions = {}): Promise<ExcelParseResult> {
    const { maxRows = 10000, sheetIndex = 0 } = options

    const workbook = XLSX.read(buffer, {
      cellStyles: true,
      cellFormula: true,
      cellDates: true,
      cellNF: true,
      sheetStubs: true,
    })

    const sheetName = workbook.SheetNames[sheetIndex]
    const worksheet = workbook.Sheets[sheetName]

    if (!worksheet) {
      throw new Error(`Sheet at index ${sheetIndex} not found`)
    }

    const headers = this.extractHeaders(worksheet)
    const rows = this.extractRows(worksheet, headers.length, maxRows)

    return {
      headers,
      rows,
      metadata: {
        sheetName,
        totalRows: rows.length,
        totalColumns: headers.length,
      },
    }
  }

  private extractHeaders(worksheet: XLSX.WorkSheet): string[] {
    const headers: string[] = []
    let col = 0

    while (true) {
      const cellAddr = XLSX.utils.encode_cell({ r: 0, c: col })
      const cell = worksheet[cellAddr]
      if (!cell) break
      headers.push(String(cell.v || ''))
      col++
    }

    if (headers.length === 0) {
      throw new Error('No headers found in Excel file')
    }

    return headers
  }

  private extractRows(worksheet: XLSX.WorkSheet, maxCol: number, maxRows: number): any[][] {
    const rows: any[][] = []
    let row = 1

    while (row < maxRows + 1) {
      const rowData: any[] = []
      let hasData = false

      for (let c = 0; c < maxCol; c++) {
        const cellAddr = XLSX.utils.encode_cell({ r: row, c })
        const cell = worksheet[cellAddr]

        if (cell) {
          hasData = true
          rowData.push(this.parseCellValue(cell))
        } else {
          rowData.push(null)
        }
      }

      if (!hasData) break
      rows.push(rowData)
      row++
    }

    return rows
  }

  private parseCellValue(cell: XLSX.CellObject): any {
    const value = cell.v

    if (cell.t === 'd' || value instanceof Date) {
      return value
    }

    if (cell.t === 'n' && typeof value === 'number' && this.isExcelDate(cell)) {
      return new Date((value - 25569) * 86400 * 1000)
    }

    return value
  }

  private isExcelDate(cell: XLSX.CellObject): boolean {
    const format = cell.z || cell.w
    if (!format) return false

    const datePatterns = ['m/', 'd/', 'y/', 'h:', 'm:', 's:']
    return datePatterns.some((pattern) => `${format}`.toLowerCase().includes(pattern))
  }
}
