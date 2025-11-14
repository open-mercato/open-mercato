import type { ModuleCli } from '@/modules/registry'
import { createRequestContainer } from '@/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import { Dictionary, DictionaryEntry, type DictionaryManagerVisibility } from '@open-mercato/core/modules/dictionaries/data/entities'

const UNIT_DEFAULTS: Array<{ value: string; label: string; description?: string }> = [
  { value: 'each', label: 'Each' },
  { value: 'set', label: 'Set' },
  { value: 'pack', label: 'Pack' },
  { value: 'kg', label: 'Kilogram' },
  { value: 'g', label: 'Gram' },
  { value: 'lb', label: 'Pound' },
  { value: 'oz', label: 'Ounce' },
  { value: 'l', label: 'Liter' },
  { value: 'ml', label: 'Milliliter' },
  { value: 'm', label: 'Meter' },
]

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

export default [seedUnitsCommand]
