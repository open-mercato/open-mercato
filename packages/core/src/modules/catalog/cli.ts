import type { ModuleCli } from '@/modules/registry'
import { createRequestContainer } from '@/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import { Dictionary, DictionaryEntry, type DictionaryManagerVisibility } from '@open-mercato/core/modules/dictionaries/data/entities'
import { CatalogPriceKind } from './data/entities'
import { seedCatalogExamples } from './seed/examples'

const UNIT_DEFAULTS: Array<{ value: string; label: string; description?: string }> = [
  { value: 'pc', label: 'Piece (piece)' },
  { value: 'set', label: 'Set (piece)' },
  { value: 'pkg', label: 'Package (piece)' },
  { value: 'box', label: 'Box (piece)' },
  { value: 'roll', label: 'Roll (piece)' },
  { value: 'pair', label: 'Pair (piece)' },
  { value: 'dozen', label: 'Dozen (piece)' },
  { value: 'unit', label: 'Unit (piece)' },
  { value: 'g', label: 'Gram (weight)' },
  { value: 'kg', label: 'Kilogram (weight)' },
  { value: 'mg', label: 'Milligram (weight)' },
  { value: 'lb', label: 'Pound (weight)' },
  { value: 'oz', label: 'Ounce (weight)' },
  { value: 'ml', label: 'Milliliter (volume)' },
  { value: 'l', label: 'Liter (volume)' },
  { value: 'cl', label: 'Centiliter (volume)' },
  { value: 'm3', label: 'Cubic Meter (volume)' },
  { value: 'mm', label: 'Millimeter (length)' },
  { value: 'cm', label: 'Centimeter (length)' },
  { value: 'm', label: 'Meter (length)' },
  { value: 'km', label: 'Kilometer (length)' },
  { value: 'in', label: 'Inch (length)' },
  { value: 'ft', label: 'Foot (length)' },
  { value: 'm2', label: 'Square Meter (area)' },
  { value: 'cm2', label: 'Square Centimeter (area)' },
  { value: 'ft2', label: 'Square Foot (area)' },
  { value: 'gb', label: 'Gigabyte (digital)' },
  { value: 'mb', label: 'Megabyte (digital)' },
  { value: 'tb', label: 'Terabyte (digital)' },
  { value: 'license', label: 'License (digital)' },
  { value: 'seat', label: 'Seat (digital)' },
  { value: 'sec', label: 'Second (time)' },
  { value: 'min', label: 'Minute (time)' },
  { value: 'hour', label: 'Hour (time)' },
  { value: 'day', label: 'Day (time)' },
  { value: 'week', label: 'Week (time)' },
  { value: 'month', label: 'Month (time)' },
  { value: 'year', label: 'Year (time)' },
  { value: 'kwh', label: 'Kilowatt Hour (energy)' },
]

const PRICE_KIND_DEFAULTS = [
  { code: 'regular', title: 'Regular', isPromotion: false, displayMode: 'including-tax' as const, currencyCode: 'USD' as const },
  { code: 'sale', title: 'Sale', isPromotion: true, displayMode: 'including-tax' as const, currencyCode: 'USD' as const },
] as const

function parseArgs(rest: string[]) {
  const args: Record<string, string> = {}
  for (let i = 0; i < rest.length; i += 1) {
    const part = rest[i]
    if (!part) continue
    if (part.startsWith('--')) {
      const [rawKey, rawValue] = part.slice(2).split('=')
      if (rawValue !== undefined) args[rawKey] = rawValue
      else if (rest[i + 1] && !rest[i + 1]!.startsWith('--')) {
        args[rawKey] = rest[i + 1]!
        i += 1
      }
    }
  }
  return args
}

async function seedUnitDictionary(
  em: EntityManager,
  { tenantId, organizationId }: { tenantId: string; organizationId: string },
) {
  let dictionary = await em.findOne(Dictionary, {
    tenantId,
    organizationId,
    key: 'unit',
    deletedAt: null,
  })
  if (!dictionary) {
    dictionary = em.create(Dictionary, {
      key: 'unit',
      name: 'Units of measure',
      description: 'Reusable units for catalog products and pricing.',
      tenantId,
      organizationId,
      isSystem: true,
      isActive: true,
      managerVisibility: 'default' satisfies DictionaryManagerVisibility,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    em.persist(dictionary)
    await em.flush()
  }
  const existingEntries = await em.find(DictionaryEntry, {
    dictionary,
    tenantId,
    organizationId,
  })
  const existingMap = new Map(existingEntries.map((entry) => [entry.value.toLowerCase(), entry]))
  for (const unit of UNIT_DEFAULTS) {
    const key = unit.value.toLowerCase()
    if (existingMap.has(key)) continue
    const entry = em.create(DictionaryEntry, {
      dictionary,
      tenantId,
      organizationId,
      value: unit.value,
      normalizedValue: key,
      label: unit.label,
      color: null,
      icon: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    em.persist(entry)
  }
  await em.flush()
}

async function seedPriceKinds(
  em: EntityManager,
  { tenantId, organizationId }: { tenantId: string; organizationId: string },
) {
  const existing = await em.find(CatalogPriceKind, {
    tenantId,
    organizationId,
  })
  const defaultsByCode = new Map(PRICE_KIND_DEFAULTS.map((def) => [def.code.toLowerCase(), def]))
  const now = new Date()
  const seen = new Set<string>()

  for (const record of existing) {
    const key = record.code.toLowerCase()
    const def = defaultsByCode.get(key)
    if (!def) {
      if (record.deletedAt == null) {
        record.deletedAt = now
        record.isActive = false
        record.updatedAt = now
      }
      continue
    }
    record.title = def.title
    record.displayMode = def.displayMode ?? 'including-tax'
    record.currencyCode = def.currencyCode ?? null
    record.isPromotion = def.isPromotion
    record.isActive = true
    record.deletedAt = null
    record.updatedAt = now
    seen.add(key)
  }

  for (const def of PRICE_KIND_DEFAULTS) {
    const key = def.code.toLowerCase()
    if (seen.has(key)) continue
    const record = em.create(CatalogPriceKind, {
      organizationId,
      tenantId,
      code: def.code,
      title: def.title,
      displayMode: def.displayMode ?? 'including-tax',
      currencyCode: def.currencyCode ?? null,
      isPromotion: def.isPromotion,
      isActive: true,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    })
    em.persist(record)
  }
  await em.flush()
}

const seedUnitsCommand: ModuleCli = {
  command: 'seed-units',
  async run(rest) {
    const args = parseArgs(rest)
    const tenantId = String(args.tenantId ?? args.tenant ?? '')
    const organizationId = String(args.organizationId ?? args.org ?? args.orgId ?? '')
    if (!tenantId || !organizationId) {
      console.error('Usage: mercato catalog seed-units --tenant <tenantId> --org <organizationId>')
      return
    }
    const container = await createRequestContainer()
    const em = container.resolve('em') as EntityManager
    await em.transactional(async (tem) => {
      await seedUnitDictionary(tem, { tenantId, organizationId })
    })
    console.log('Unit dictionary seeded for organization', organizationId)
  },
}

const seedPriceKindsCommand: ModuleCli = {
  command: 'seed-price-kinds',
  async run(rest) {
    const args = parseArgs(rest)
    const tenantId = String(args.tenantId ?? args.tenant ?? '')
    const organizationId = String(args.organizationId ?? args.org ?? args.orgId ?? '')
    if (!tenantId || !organizationId) {
      console.error('Usage: mercato catalog seed-price-kinds --tenant <tenantId> --org <organizationId>')
      return
    }
    const container = await createRequestContainer()
    const em = container.resolve('em') as EntityManager
    await em.transactional(async (tem) => {
      await seedPriceKinds(tem, { tenantId, organizationId })
    })
    console.log('Price kinds seeded for organization', organizationId)
  },
}

const seedExamplesCommand: ModuleCli = {
  command: 'seed-examples',
  async run(rest) {
    const args = parseArgs(rest)
    const tenantId = String(args.tenantId ?? args.tenant ?? '')
    const organizationId = String(args.organizationId ?? args.org ?? args.orgId ?? '')
    if (!tenantId || !organizationId) {
      console.error('Usage: mercato catalog seed-examples --tenant <tenantId> --org <organizationId>')
      return
    }
    const container = await createRequestContainer()
    const em = container.resolve('em') as EntityManager
    let seeded = false
    try {
      seeded = await em.transactional(async (tem) =>
        seedCatalogExamples(tem, container, { tenantId, organizationId })
      )
    } finally {
      const disposable = container as unknown as { dispose?: () => Promise<void> }
      if (typeof disposable.dispose === 'function') {
        await disposable.dispose()
      }
    }
    if (seeded) {
      console.log('Catalog example data seeded for organization', organizationId)
    } else {
      console.log('Catalog example data already present; skipping')
    }
  },
}

export default [seedUnitsCommand, seedPriceKindsCommand, seedExamplesCommand]
