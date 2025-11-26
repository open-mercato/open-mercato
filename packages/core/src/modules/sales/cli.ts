import type { ModuleCli } from '@/modules/registry'
import { createRequestContainer } from '@/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import { SalesTaxRate } from './data/entities'
import { seedSalesStatusDictionaries } from './lib/dictionaries'

const DEFAULT_TAX_RATES = [
  { code: 'vat-23', name: '23% VAT', rate: '23' },
  { code: 'vat-0', name: '0% VAT', rate: '0' },
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

const seedTaxRatesCommand: ModuleCli = {
  command: 'seed-tax-rates',
  async run(rest) {
    const args = parseArgs(rest)
    const tenantId = String(args.tenantId ?? args.tenant ?? '')
    const organizationId = String(args.organizationId ?? args.org ?? args.orgId ?? '')
    if (!tenantId || !organizationId) {
      console.error('Usage: mercato sales seed-tax-rates --tenant <tenantId> --org <organizationId>')
      return
    }
    const container = await createRequestContainer()
    const em = container.resolve('em') as EntityManager
    try {
      await em.transactional(async (tem) => {
        const existing = await tem.find(SalesTaxRate, {
          tenantId,
          organizationId,
          deletedAt: null,
        })
        const existingCodes = new Set(existing.map((entry) => entry.code.toLowerCase()))
        const hasDefault = existing.some((entry) => entry.isDefault)
        let assignedDefault = hasDefault
        const now = new Date()
        for (const def of DEFAULT_TAX_RATES) {
          if (existingCodes.has(def.code)) continue
          const shouldSetDefault = !assignedDefault
          const record = tem.create(SalesTaxRate, {
            organizationId,
            tenantId,
            name: def.name,
            code: def.code,
            rate: def.rate,
            countryCode: null,
            regionCode: null,
            postalCode: null,
            city: null,
            customerGroupId: null,
            productCategoryId: null,
            channelId: null,
            priority: 0,
            isCompound: false,
            isDefault: shouldSetDefault,
            metadata: null,
            startsAt: null,
            endsAt: null,
            createdAt: now,
            updatedAt: now,
          })
          if (shouldSetDefault) assignedDefault = true
          tem.persist(record)
        }
      })
      console.log('🧾 Tax rates seeded for organization', organizationId)
    } finally {
      const disposable = container as unknown as { dispose?: () => Promise<void> }
      if (typeof disposable.dispose === 'function') {
        await disposable.dispose()
      }
    }
  },
}

const seedStatusesCommand: ModuleCli = {
  command: 'seed-statuses',
  async run(rest) {
    const args = parseArgs(rest)
    const tenantId = String(args.tenantId ?? args.tenant ?? '')
    const organizationId = String(args.organizationId ?? args.org ?? args.orgId ?? '')
    if (!tenantId || !organizationId) {
      console.error('Usage: mercato sales seed-statuses --tenant <tenantId> --org <organizationId>')
      return
    }
    const container = await createRequestContainer()
    try {
      const em = container.resolve<EntityManager>('em')
      await em.transactional(async (tem) => {
        await seedSalesStatusDictionaries(tem, { tenantId, organizationId })
        await tem.flush()
      })
      console.log('🚦 Sales order statuses seeded for organization', organizationId)
    } finally {
      const disposable = container as unknown as { dispose?: () => Promise<void> }
      if (typeof disposable.dispose === 'function') {
        await disposable.dispose()
      }
    }
  },
}

export default [seedTaxRatesCommand, seedStatusesCommand]
