import type { EntityManager } from '@mikro-orm/postgresql'
import { ExcelService } from './excel-parse.service'
import { FmsLocation } from '../data/entities'
import { csvImportRowSchema, type CsvImportRow } from '../data/validators'
import type { LocationType } from '../data/types'

export interface ImportContext {
  email: string
  actorOrgId: string
  actorTenantId: string
  actorUserId?: string
}

export interface ImportResult {
  locationsCreated: number
  locationsUpdated: number
  errors: Array<{ row: number; message: string }>
  totalRows: number
}

interface HeaderMap {
  code: number
  name: number
  type: number
  lat?: number
  lng?: number
  locode?: number
  port_code?: number
  city?: number
  country?: number
}

export class LocationImportService {
  constructor(
    private excelService: ExcelService,
    private em: EntityManager
  ) {}

  async importFromFile(file: File, context: ImportContext): Promise<ImportResult> {
    const buffer = Buffer.from(await file.arrayBuffer())
    const parsed = await this.excelService.parseFile(buffer)

    const headerMap = this.mapHeaders(parsed.headers)
    const errors: Array<{ row: number; message: string }> = []

    const portRows: Array<{ rowIndex: number; data: CsvImportRow }> = []
    const terminalRows: Array<{ rowIndex: number; data: CsvImportRow }> = []

    for (let i = 0; i < parsed.rows.length; i++) {
      const row = parsed.rows[i]
      const rowData = this.extractRowData(row, headerMap)

      const parseResult = csvImportRowSchema.safeParse(rowData)
      if (!parseResult.success) {
        errors.push({
          row: i + 2,
          message: parseResult.error.issues.map((issue) => issue.message).join(', '),
        })
        continue
      }

      const data = parseResult.data
      if (data.type === 'port') {
        portRows.push({ rowIndex: i + 2, data })
      } else {
        terminalRows.push({ rowIndex: i + 2, data })
      }
    }

    const portsResult = await this.importLocations(portRows, 'port', context, errors)
    const portCodeToId = await this.buildPortLookup(context.actorTenantId, context.actorOrgId)
    const terminalsResult = await this.importLocations(
      terminalRows,
      'terminal',
      context,
      errors,
      portCodeToId
    )

    return {
      locationsCreated: portsResult.created + terminalsResult.created,
      locationsUpdated: portsResult.updated + terminalsResult.updated,
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
    const nameIdx = findIndex(['name'])
    const typeIdx = findIndex(['type'])

    if (codeIdx === undefined) throw new Error('Missing required column: code')
    if (nameIdx === undefined) throw new Error('Missing required column: name')
    if (typeIdx === undefined) throw new Error('Missing required column: type')

    return {
      code: codeIdx,
      name: nameIdx,
      type: typeIdx,
      lat: findIndex(['lat', 'latitude']),
      lng: findIndex(['lng', 'lon', 'longitude']),
      locode: findIndex(['locode', 'un_locode', 'unlocode']),
      port_code: findIndex(['port_code', 'portcode', 'parent_code']),
      city: findIndex(['city']),
      country: findIndex(['country']),
    }
  }

  private extractRowData(row: any[], headerMap: HeaderMap): Record<string, any> {
    const getValue = (idx: number | undefined): any => {
      if (idx === undefined) return null
      return row[idx] ?? null
    }

    return {
      code: getValue(headerMap.code),
      name: getValue(headerMap.name),
      type: getValue(headerMap.type),
      lat: getValue(headerMap.lat),
      lng: getValue(headerMap.lng),
      locode: getValue(headerMap.locode),
      port_code: getValue(headerMap.port_code),
      city: getValue(headerMap.city),
      country: getValue(headerMap.country),
    }
  }

  private async importLocations(
    rows: Array<{ rowIndex: number; data: CsvImportRow }>,
    type: LocationType,
    context: ImportContext,
    errors: Array<{ row: number; message: string }>,
    portCodeToId?: Map<string, string>
  ): Promise<{ created: number; updated: number }> {
    let created = 0
    let updated = 0

    for (const { rowIndex, data } of rows) {
      try {
        const existing = await this.em.findOne(FmsLocation, {
          code: data.code.toUpperCase(),
          organizationId: context.actorOrgId,
          tenantId: context.actorTenantId,
          deletedAt: null,
        })

        let portId: string | null = null
        if (type === 'terminal' && data.port_code && portCodeToId) {
          portId = portCodeToId.get(data.port_code.toUpperCase()) ?? null
          if (!portId && data.port_code) {
            errors.push({
              row: rowIndex,
              message: `Port with code "${data.port_code}" not found`,
            })
          }
        }

        if (existing) {
          existing.name = data.name
          if (data.lat !== null && data.lat !== undefined) existing.lat = data.lat
          if (data.lng !== null && data.lng !== undefined) existing.lng = data.lng
          if (data.locode) existing.locode = data.locode.toUpperCase()
          if (data.city) existing.city = data.city
          if (data.country) existing.country = data.country
          if (portId) existing.portId = portId
          existing.updatedAt = new Date()
          if (context.actorUserId) existing.updatedBy = context.actorUserId
          updated++
        } else {
          const location = this.em.create(FmsLocation, {
            code: data.code.toUpperCase(),
            name: data.name,
            type,
            organizationId: context.actorOrgId,
            tenantId: context.actorTenantId,
            lat: data.lat ?? null,
            lng: data.lng ?? null,
            locode: data.locode?.toUpperCase() ?? null,
            city: data.city ?? null,
            country: data.country ?? null,
            portId,
            createdBy: context.actorUserId ?? null,
          })
          this.em.persist(location)
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

  private async buildPortLookup(
    tenantId: string,
    orgId: string
  ): Promise<Map<string, string>> {
    const ports = await this.em.find(FmsLocation, {
      type: 'port',
      tenantId,
      organizationId: orgId,
      deletedAt: null,
    })

    const map = new Map<string, string>()
    for (const port of ports) {
      map.set(port.code.toUpperCase(), port.id)
    }
    return map
  }

}
