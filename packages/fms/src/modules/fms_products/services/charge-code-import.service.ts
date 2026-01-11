import type { EntityManager } from '@mikro-orm/postgresql'
import { ExcelService } from './excel-parse.service'
import { FmsChargeCode } from '../data/entities'
import { csvImportChargeCodeSchema, type CsvImportChargeCode } from '../data/validators'

export interface ImportContext {
  email: string
  actorOrgId: string
  actorTenantId: string
  actorUserId?: string
}

export interface ImportResult {
  chargeCodesCreated: number
  chargeCodesUpdated: number
  errors: Array<{ row: number; message: string }>
  totalRows: number
}

interface HeaderMap {
  code: number
  description?: number
  charge_unit: number
}

export class ChargeCodeImportService {
  constructor(
    private excelService: ExcelService,
    private em: EntityManager
  ) {}

  async importFromFile(file: File, context: ImportContext): Promise<ImportResult> {
    const buffer = Buffer.from(await file.arrayBuffer())
    const parsed = await this.excelService.parseFile(buffer)

    const headerMap = this.mapHeaders(parsed.headers)
    const errors: Array<{ row: number; message: string }> = []

    const chargeCodeRows: Array<{ rowIndex: number; data: CsvImportChargeCode }> = []

    for (let i = 0; i < parsed.rows.length; i++) {
      const row = parsed.rows[i]
      const rowData = this.extractRowData(row, headerMap)

      const parseResult = csvImportChargeCodeSchema.safeParse(rowData)
      if (!parseResult.success) {
        errors.push({
          row: i + 2,
          message: parseResult.error.issues.map((issue) => issue.message).join(', '),
        })
        continue
      }

      chargeCodeRows.push({ rowIndex: i + 2, data: parseResult.data })
    }

    const result = await this.importChargeCodes(chargeCodeRows, context, errors)

    return {
      chargeCodesCreated: result.created,
      chargeCodesUpdated: result.updated,
      errors,
      totalRows: parsed.rows.length,
    }
  }

  private mapHeaders(headers: string[]): HeaderMap {
    const normalizedHeaders = headers.map((h) => h.toLowerCase().trim().replace(/\s+/g, '_'))

    const findIndex = (names: string[]): number | undefined => {
      for (const name of names) {
        const idx = normalizedHeaders.indexOf(name)
        if (idx !== -1) return idx
      }
      return undefined
    }

    const codeIdx = findIndex(['code'])
    const chargeUnitIdx = findIndex(['charge_unit', 'chargeunit', 'unit'])

    if (codeIdx === undefined) throw new Error('Missing required column: code')
    if (chargeUnitIdx === undefined) throw new Error('Missing required column: charge_unit')

    return {
      code: codeIdx,
      charge_unit: chargeUnitIdx,
      description: findIndex(['description', 'desc']),
    }
  }

  private extractRowData(row: any[], headerMap: HeaderMap): Record<string, any> {
    const getValue = (idx: number | undefined): any => {
      if (idx === undefined) return null
      return row[idx] ?? null
    }

    return {
      code: getValue(headerMap.code),
      description: getValue(headerMap.description),
      charge_unit: getValue(headerMap.charge_unit),
    }
  }

  private async importChargeCodes(
    rows: Array<{ rowIndex: number; data: CsvImportChargeCode }>,
    context: ImportContext,
    errors: Array<{ row: number; message: string }>
  ): Promise<{ created: number; updated: number }> {
    let created = 0
    let updated = 0

    for (const { rowIndex, data } of rows) {
      try {
        const existing = await this.em.findOne(FmsChargeCode, {
          code: data.code.toUpperCase(),
          organizationId: context.actorOrgId,
          tenantId: context.actorTenantId,
          deletedAt: null,
        })

        if (existing) {
          if (data.description) existing.description = data.description
          existing.chargeUnit = data.charge_unit
          existing.updatedAt = new Date()
          if (context.actorUserId) existing.updatedBy = context.actorUserId
          updated++
        } else {
          const chargeCode = this.em.create(FmsChargeCode, {
            code: data.code.toUpperCase(),
            description: data.description ?? null,
            chargeUnit: data.charge_unit,
            organizationId: context.actorOrgId,
            tenantId: context.actorTenantId,
            isActive: true,
            createdBy: context.actorUserId ?? null,
          })
          this.em.persist(chargeCode)
          created++
        }
      } catch (err) {
        errors.push({
          row: rowIndex,
          message: err instanceof Error ? err.message : 'Unknown error',
        })
      }
    }

    await this.em.flush()
    return { created, updated }
  }
}
