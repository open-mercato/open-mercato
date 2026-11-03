const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type StatementSeedingParams =
  | { mode: 'duplicate'; id: string; ignoredOrder?: boolean }
  | { mode: 'order'; id: string }
  | { mode: 'none'; ignoredOrder?: boolean }

export type StatementSeedSource = {
  id?: string | null
  title?: string | null
  commodity?: string | null
  activityType?: string | null
  actorRole?: string | null
  orderId?: string | null
  quantityKg?: number | string | null
  supplementaryUnit?: string | null
  supplementaryQuantity?: number | string | null
  notes?: string | null
}

export type StatementSeedValues = {
  title: string
  commodity: string
  activityType: string
  actorRole: string
  orderId: string
  quantityKg: string
  supplementaryUnit: string
  supplementaryQuantity: string
  notes: string
}

function validUuid(value: string | null): string | null {
  if (!value) return null
  const trimmed = value.trim()
  return UUID_PATTERN.test(trimmed) ? trimmed : null
}

function textValue(value: string | null | undefined): string {
  return typeof value === 'string' ? value : ''
}

function numberTextValue(value: number | string | null | undefined): string {
  return typeof value === 'number' || typeof value === 'string' ? String(value) : ''
}

export function resolveSeedingParams(
  searchParams: { get(name: string): string | null },
): StatementSeedingParams {
  const duplicateId = validUuid(searchParams.get('duplicateFrom'))
  const orderId = validUuid(searchParams.get('orderId'))

  if (duplicateId) {
    return orderId
      ? { mode: 'duplicate', id: duplicateId, ignoredOrder: true }
      : { mode: 'duplicate', id: duplicateId }
  }
  if (orderId) return { mode: 'order', id: orderId }
  return { mode: 'none' }
}

export function buildDuplicateSeed(source: StatementSeedSource): Partial<StatementSeedValues> {
  return {
    title: textValue(source.title),
    commodity: textValue(source.commodity),
    activityType: textValue(source.activityType),
    actorRole: textValue(source.actorRole),
    orderId: textValue(source.orderId),
    quantityKg: numberTextValue(source.quantityKg),
    supplementaryUnit: textValue(source.supplementaryUnit),
    supplementaryQuantity: numberTextValue(source.supplementaryQuantity),
    notes: textValue(source.notes),
  }
}

export function pickUnambiguousCommodity(
  mappings: Array<{ commodity: string; isInScope: boolean }>,
): string | null {
  const commodities = new Set<string>()
  for (const mapping of mappings) {
    if (!mapping.isInScope) continue
    const commodity = mapping.commodity.trim()
    if (commodity) commodities.add(commodity)
  }
  return commodities.size === 1 ? Array.from(commodities)[0] : null
}
