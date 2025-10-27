import type { ModuleCli } from '@/modules/registry'
import { createRequestContainer } from '@/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import { Dictionary, DictionaryEntry } from '@open-mercato/core/modules/dictionaries/data/entities'
import {
  CustomerEntity,
  CustomerCompanyProfile,
  CustomerPersonProfile,
  CustomerDeal,
  CustomerDealPersonLink,
  CustomerDealCompanyLink,
  CustomerActivity,
  CustomerAddress,
} from './data/entities'
import { ensureDictionaryEntry } from './commands/shared'

type SeedArgs = {
  tenantId: string
  organizationId: string
}

const DEAL_STATUS_DEFAULTS = [
  { value: 'open', label: 'Open' },
  { value: 'closed', label: 'Closed' },
  { value: 'win', label: 'Win' },
  { value: 'loose', label: 'Loose' },
  { value: 'in_progress', label: 'In progress' },
]

const PIPELINE_STAGE_DEFAULTS = [
  { value: 'opportunity', label: 'Opportunity' },
  { value: 'marketing_qualified_lead', label: 'Marketing Qualified Lead' },
  { value: 'sales_qualified_lead', label: 'Sales Qualified Lead' },
  { value: 'offering', label: 'Offering' },
  { value: 'negotiations', label: 'Negotiations' },
  { value: 'win', label: 'Win' },
  { value: 'loose', label: 'Loose' },
  { value: 'stalled', label: 'Stalled' },
]

const PRIORITY_CURRENCIES = ['EUR', 'USD', 'GBP', 'PLN']

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

async function seedCustomerDictionaries(em: EntityManager, { tenantId, organizationId }: SeedArgs) {
  for (const entry of DEAL_STATUS_DEFAULTS) {
    await ensureDictionaryEntry(em, {
      tenantId,
      organizationId,
      kind: 'deal_status',
      value: entry.value,
      label: entry.label,
    })
  }
  for (const entry of PIPELINE_STAGE_DEFAULTS) {
    await ensureDictionaryEntry(em, {
      tenantId,
      organizationId,
      kind: 'pipeline_stage',
      value: entry.value,
      label: entry.label,
    })
  }
}

function resolveCurrencyCodes(): string[] {
  const normalizedPriority = PRIORITY_CURRENCIES.map((code) => code.toUpperCase())
  const prioritySet = new Set(normalizedPriority)
  const supported: string[] =
    typeof (Intl as any)?.supportedValuesOf === 'function'
      ? ((Intl as any).supportedValuesOf('currency') as string[])
      : []
  const normalizedSupported = supported
    .map((code) => code.toUpperCase())
    .filter((code) => /^[A-Z]{3}$/.test(code))
  const uniqueSupported: string[] = []
  const seen = new Set<string>(normalizedPriority)
  for (const code of normalizedSupported) {
    if (seen.has(code)) continue
    seen.add(code)
    uniqueSupported.push(code)
  }
  if (!uniqueSupported.length) {
    console.warn('[customers.cli] Intl.supportedValuesOf("currency") unavailable; seeding minimal currency list.')
    return normalizedPriority
  }
  uniqueSupported.sort()
  return [...normalizedPriority, ...uniqueSupported]
}

function resolveCurrencyLabel(code: string): string {
  try {
    if (typeof (Intl as any).DisplayNames === 'function') {
      const displayNames = new (Intl as any).DisplayNames(['en'], { type: 'currency' })
      const label = displayNames.of(code)
      if (typeof label === 'string' && label.trim().length) {
        return `${code} – ${label}`
      }
    }
  } catch (err) {
    console.warn('[customers.cli] Unable to resolve currency label for', code, err)
  }
  return code
}

async function seedCurrencyDictionary(em: EntityManager, { tenantId, organizationId }: SeedArgs) {
  let dictionary = await em.findOne(Dictionary, {
    tenantId,
    organizationId,
    key: 'currency',
    deletedAt: null,
  })
  if (!dictionary) {
    dictionary = em.create(Dictionary, {
      key: 'currency',
      name: 'Currencies',
      description: 'ISO 4217 currencies',
      tenantId,
      organizationId,
      isSystem: true,
      isActive: true,
    })
    em.persist(dictionary)
    await em.flush()
  }

  const existingEntries = await em.find(DictionaryEntry, {
    dictionary,
    tenantId,
    organizationId,
  })
  const existingMap = new Map<string, DictionaryEntry>()
  existingEntries.forEach((entry) => existingMap.set(entry.value.toUpperCase(), entry))

  const currencyCodes = resolveCurrencyCodes()
  for (const code of currencyCodes) {
    const upper = code.toUpperCase()
    const normalizedValue = upper.toLowerCase()
    const label = resolveCurrencyLabel(upper)
    const current = existingMap.get(upper)
    if (current) {
      if (current.label !== label) {
        current.label = label
        current.updatedAt = new Date()
        em.persist(current)
      }
      continue
    }
    const entry = em.create(DictionaryEntry, {
      dictionary,
      tenantId,
      organizationId,
      value: upper,
      normalizedValue,
      label,
      color: null,
      icon: null,
    })
    em.persist(entry)
  }
}

const seedDictionaries: ModuleCli = {
  command: 'seed-dictionaries',
  async run(rest) {
    const args = parseArgs(rest)
    const tenantId = String(args.tenantId ?? args.tenant ?? '')
    const organizationId = String(args.organizationId ?? args.orgId ?? args.org ?? '')
    if (!tenantId || !organizationId) {
      console.error('Usage: mercato customers seed-dictionaries --tenant <tenantId> --org <organizationId>')
      return
    }
    const { resolve } = await createRequestContainer()
    const em = resolve<EntityManager>('em')
    await em.transactional(async (tem) => {
      await seedCustomerDictionaries(tem, { tenantId, organizationId })
      await seedCurrencyDictionary(tem, { tenantId, organizationId })
      await tem.flush()
    })
    console.log('Customer dictionaries seeded for organization', organizationId)
  },
}

export default [seedDictionaries]
