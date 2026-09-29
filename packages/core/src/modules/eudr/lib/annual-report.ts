import { z } from 'zod'
import {
  serializeExport,
  type CrudExportColumn,
  type PreparedExport,
} from '@open-mercato/shared/lib/crud/exporters'

const nonNegativeIntegerSchema = z.number().int().nonnegative()

const supplementaryQuantitySchema = z.object({
  unit: z.string(),
  quantity: z.string(),
})

const commodityReportSchema = z.object({
  commodity: z.string(),
  count: nonNegativeIntegerSchema,
  quantityKg: z.string(),
  supplementaryQuantities: z.array(supplementaryQuantitySchema),
})

export const annualReportSchema = z.object({
  year: z.number().int(),
  generatedAt: z.string().datetime(),
  statements: z.object({
    total: nonNegativeIntegerSchema,
    byStatus: z.record(z.string(), nonNegativeIntegerSchema),
    byCommodity: z.array(commodityReportSchema),
  }),
  countries: z.array(z.object({
    country: z.string(),
    tier: z.string(),
    submissionCount: nonNegativeIntegerSchema,
  })).optional(),
  risk: z.object({
    assessments: nonNegativeIntegerSchema,
    negligible: nonNegativeIntegerSchema,
    nonNegligible: nonNegativeIntegerSchema,
    simplified: nonNegativeIntegerSchema,
  }).optional(),
  mitigation: z.object({
    total: nonNegativeIntegerSchema,
    completed: nonNegativeIntegerSchema,
  }).optional(),
})

export type AnnualReport = z.infer<typeof annualReportSchema>

function parseThousandths(value: string | number | null): bigint | null {
  if (value === null) return 0n
  const normalized = typeof value === 'number' ? value.toFixed(3) : value.trim()
  const match = /^([+-]?)(\d+)(?:\.(\d{1,3}))?$/.exec(normalized)
  if (match === null) return null

  const sign = match[1] === '-' ? -1n : 1n
  const whole = BigInt(match[2]) * 1000n
  const fraction = BigInt((match[3] ?? '').padEnd(3, '0') || '0')
  return sign * (whole + fraction)
}

function formatThousandths(value: bigint): string {
  const sign = value < 0n ? '-' : ''
  const absolute = value < 0n ? -value : value
  const whole = absolute / 1000n
  const fraction = (absolute % 1000n).toString().padStart(3, '0')
  return `${sign}${whole}.${fraction}`
}

export function accumulateSupplementaryQuantities(
  rows: Array<{ unit: string | null; quantity: string | number | null }>,
): Array<{ unit: string; quantity: string }> {
  const quantities = new Map<string, bigint>()

  for (const row of rows) {
    const unit = row.unit?.trim().toUpperCase() ?? ''
    if (unit.length === 0) continue
    const quantity = parseThousandths(row.quantity)
    if (quantity === null) continue
    quantities.set(unit, (quantities.get(unit) ?? 0n) + quantity)
  }

  return Array.from(quantities, ([unit, quantity]) => ({
    unit,
    quantity: formatThousandths(quantity),
  }))
}

const annualReportCsvColumns: CrudExportColumn[] = [
  { field: 'commodity', header: 'commodity' },
  { field: 'count', header: 'count' },
  { field: 'quantityKg', header: 'quantityKg' },
  { field: 'supplementaryUnit', header: 'supplementaryUnit' },
  { field: 'supplementaryQuantity', header: 'supplementaryQuantity' },
]

export function buildAnnualReportCsv(report: AnnualReport): { content: string; contentType: string } {
  const rows: PreparedExport['rows'] = report.statements.byCommodity.flatMap((commodity) => {
    const supplementaryQuantities = commodity.supplementaryQuantities.length > 0
      ? commodity.supplementaryQuantities
      : [null]

    return supplementaryQuantities.map((supplementaryQuantity) => ({
      commodity: commodity.commodity,
      count: commodity.count,
      quantityKg: commodity.quantityKg,
      supplementaryUnit: supplementaryQuantity?.unit ?? '',
      supplementaryQuantity: supplementaryQuantity?.quantity ?? '',
    }))
  })
  const prepared: PreparedExport = {
    columns: annualReportCsvColumns,
    rows,
  }
  const serialized = serializeExport(prepared, 'csv')

  return {
    content: serialized.body,
    contentType: serialized.contentType,
  }
}
