import type { ModuleCli } from '@/modules/registry'
import { createRequestContainer } from '@/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import {
  FmsChargeCode,
  FmsProduct,
  FmsProductVariant,
  FmsProductPrice,
} from './data/entities'

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

const statsCommand: ModuleCli = {
  command: 'stats',
  async run(rest) {
    const args = parseArgs(rest)
    const tenantId = String(args.tenantId ?? args.tenant ?? '')
    const organizationId = String(args.organizationId ?? args.org ?? args.orgId ?? '')

    const container = await createRequestContainer()
    try {
      const em = container.resolve<EntityManager>('em')

      const filters: Record<string, unknown> = {}
      if (tenantId) filters.tenantId = tenantId
      if (organizationId) filters.organizationId = organizationId

      const [chargeCodes, products, variants, prices] = await Promise.all([
        em.count(FmsChargeCode, filters),
        em.count(FmsProduct, filters),
        em.count(FmsProductVariant, filters),
        em.count(FmsProductPrice, filters),
      ])

      console.log('FMS Products Statistics:')
      if (tenantId) console.log(`  Tenant: ${tenantId}`)
      if (organizationId) console.log(`  Organization: ${organizationId}`)
      console.log(`  Charge Codes: ${chargeCodes}`)
      console.log(`  Products: ${products}`)
      console.log(`  Variants: ${variants}`)
      console.log(`  Prices: ${prices}`)
    } finally {
      const disposable = container as unknown as { dispose?: () => Promise<void> }
      if (typeof disposable.dispose === 'function') {
        await disposable.dispose()
      }
    }
  },
}

export default [statsCommand]
