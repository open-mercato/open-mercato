import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import { parseCliArgs, cliLogger } from '@open-mercato/cli/lib/helpers'
import {
  installExampleCatalogData,
  seedCatalogExamplesForScope,
  seedCatalogPriceKinds,
  seedCatalogUnits,
  type CatalogSeedScope,
} from './lib/seeds'

const logger = cliLogger.forModule('catalog')

function parseArgs(rest: string[]) {
  const { args } = parseCliArgs(rest, { string: ['tenant', 'org', 'scope', 'channel'] })
  return args as Record<string, string>
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

const seedUnitsCommand: ModuleCli = {
  command: 'seed-units',
  async run(rest) {
    const args = parseArgs(rest)
    const tenantId = String(args.tenantId ?? args.tenant ?? '')
    const organizationId = String(args.organizationId ?? args.org ?? args.orgId ?? '')
    if (!tenantId || !organizationId) {
      logger.error('Usage: mercato catalog seed-units --tenant <tenantId> --org <organizationId>')
      return
    }
    const container = await createRequestContainer()
    const scope: CatalogSeedScope = { tenantId, organizationId }
    try {
      const em = container.resolve<EntityManager>('em')
      await em.transactional(async (tem) => {
        await seedCatalogUnits(tem, scope)
      })
      logger.info('📏 Unit dictionary seeded for organization', organizationId)
    } finally {
      const disposable = container as unknown as { dispose?: () => Promise<void> }
      if (typeof disposable.dispose === 'function') {
        await disposable.dispose()
      }
    }
  },
}

const seedPriceKindsCommand: ModuleCli = {
  command: 'seed-price-kinds',
  async run(rest) {
    const args = parseArgs(rest)
    const tenantId = String(args.tenantId ?? args.tenant ?? '')
    const organizationId = String(args.organizationId ?? args.org ?? args.orgId ?? '')
    if (!tenantId) {
      logger.error('Usage: mercato catalog seed-price-kinds --tenant <tenantId> [--org <organizationId>]')
      return
    }
    const container = await createRequestContainer()
    const scope = { tenantId, organizationId: organizationId || null }
    try {
      const em = container.resolve<EntityManager>('em')
      await em.transactional(async (tem) => {
        await seedCatalogPriceKinds(tem, scope)
      })
      logger.info(
        '🏷️ Price kinds seeded for tenant',
        tenantId,
        organizationId ? `(org: ${organizationId})` : '(org: shared)',
      )
    } finally {
      const disposable = container as unknown as { dispose?: () => Promise<void> }
      if (typeof disposable.dispose === 'function') {
        await disposable.dispose()
      }
    }
  },
}

const seedExamplesCommand: ModuleCli = {
  command: 'seed-examples',
  async run(rest) {
    const args = parseArgs(rest)
    const tenantId = String(args.tenantId ?? args.tenant ?? '')
    const organizationId = String(args.organizationId ?? args.org ?? args.orgId ?? '')
    if (!tenantId || !organizationId) {
      logger.error('Usage: mercato catalog seed-examples --tenant <tenantId> --org <organizationId>')
      return
    }
    const container = await createRequestContainer()
    const scope: CatalogSeedScope = { tenantId, organizationId }
    let seeded = false
    try {
      const em = container.resolve<EntityManager>('em')
      seeded = await em.transactional(async (tem) =>
        seedCatalogExamplesForScope(tem, container, scope)
      )
    } finally {
      const disposable = container as unknown as { dispose?: () => Promise<void> }
      if (typeof disposable.dispose === 'function') {
        await disposable.dispose()
      }
    }
    if (seeded) {
      logger.info('Catalog example data seeded for organization', organizationId)
    } else {
      logger.info('Catalog example data already present; skipping')
    }
  },
}

const installExamplesBundle: ModuleCli = {
  command: 'seed-examples-bundle',
  async run(rest) {
    const args = parseArgs(rest)
    const tenantId = String(args.tenantId ?? args.tenant ?? '')
    const organizationId = String(args.organizationId ?? args.org ?? args.orgId ?? '')
    if (!tenantId || !organizationId) {
      logger.error('Usage: mercato catalog seed-examples-bundle --tenant <tenantId> --org <organizationId>')
      return
    }
    const container = await createRequestContainer()
    const scope: CatalogSeedScope = { tenantId, organizationId }
    try {
      const em = container.resolve<EntityManager>('em')
      const { seededExamples } = await em.transactional(async (tem) =>
        installExampleCatalogData(container, scope, tem)
      )
      if (seededExamples) {
        logger.info('Catalog example data seeded for organization', organizationId)
      } else {
        logger.info('Catalog example data already present; skipping examples')
      }
    } finally {
      const disposable = container as unknown as { dispose?: () => Promise<void> }
      if (typeof disposable.dispose === 'function') {
        await disposable.dispose()
      }
    }
  },
}

export default [seedUnitsCommand, seedPriceKindsCommand, seedExamplesCommand, installExamplesBundle]
