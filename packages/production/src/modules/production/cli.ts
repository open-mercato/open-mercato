import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import { Dictionary, DictionaryEntry, type DictionaryManagerVisibility } from '@open-mercato/core/modules/dictionaries/data/entities'
import { PRODUCTION_SCRAP_REASON_DICTIONARY_KEY, SCRAP_REASON_DEFAULTS } from './lib/dictionaries.js'

type SeedScope = {
  tenantId: string
  organizationId: string
}

/**
 * Idempotent scrap-reason dictionary seed (task 4.2). Mirrors
 * `seedCurrencyDictionary` in `@open-mercato/core/modules/customers/cli.ts`:
 * find-or-create the `Dictionary` row by `(tenantId, organizationId, key)`,
 * then find-or-create each default `DictionaryEntry` by normalized value.
 * Safe to re-run — existing entries are left untouched (labels are
 * tenant-editable via the dictionaries manage UI once seeded).
 */
export async function seedScrapReasonDictionary(em: EntityManager, { tenantId, organizationId }: SeedScope): Promise<void> {
  let dictionary = await em.findOne(Dictionary, {
    tenantId,
    organizationId,
    key: PRODUCTION_SCRAP_REASON_DICTIONARY_KEY,
    deletedAt: null,
  })
  if (!dictionary) {
    dictionary = em.create(Dictionary, {
      key: PRODUCTION_SCRAP_REASON_DICTIONARY_KEY,
      name: 'Scrap reasons',
      description: 'Reasons recorded when a shop-floor report includes scrap quantity',
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

  const existingEntries = await em.find(DictionaryEntry, { dictionary, tenantId, organizationId })
  const existingValues = new Set(existingEntries.map((entry) => entry.normalizedValue))

  for (const entry of SCRAP_REASON_DEFAULTS) {
    const normalizedValue = entry.value.toLowerCase()
    if (existingValues.has(normalizedValue)) continue
    const created = em.create(DictionaryEntry, {
      dictionary,
      tenantId,
      organizationId,
      value: entry.value,
      normalizedValue,
      label: entry.label,
      color: null,
      icon: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    em.persist(created)
  }
  await em.flush()
}

function parseArgs(rest: string[]): Record<string, string> {
  const args: Record<string, string> = {}
  for (let i = 0; i < rest.length; i += 1) {
    const part = rest[i]
    if (!part?.startsWith('--')) continue
    const [keyRaw, valueRaw] = part.slice(2).split('=')
    if (keyRaw) {
      if (valueRaw !== undefined) args[keyRaw] = valueRaw
      else if (i + 1 < rest.length && !rest[i + 1].startsWith('--')) args[keyRaw] = rest[i + 1]
      else args[keyRaw] = 'true'
    }
  }
  return args
}

/**
 * Existing-tenant backfill path (task 4.2): `setup.seedDefaults` only runs
 * for newly-provisioned tenants, so this CLI command is the idempotent
 * backfill for tenants that already existed before this task shipped.
 */
const seedScrapReasons: ModuleCli = {
  command: 'seed-scrap-reasons',
  async run(rest) {
    const args = parseArgs(rest)
    const tenantId = String(args.tenantId ?? args.tenant ?? '')
    const organizationId = String(args.organizationId ?? args.orgId ?? args.org ?? '')
    if (!tenantId || !organizationId) {
      console.error('Usage: mercato production seed-scrap-reasons --tenant <tenantId> --org <organizationId>')
      return
    }
    const container = await createRequestContainer()
    const em = container.resolve<EntityManager>('em')
    await em.transactional(async (tem) => {
      await seedScrapReasonDictionary(tem, { tenantId, organizationId })
    })
    console.log('Scrap reasons dictionary seeded for organization', organizationId)
  },
}

const productionCliCommands = [seedScrapReasons]

export default productionCliCommands
