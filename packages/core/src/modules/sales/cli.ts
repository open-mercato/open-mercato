import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import { parseCliArgs, cliLogger } from '@open-mercato/cli/lib/helpers'
import { seedSalesAdjustmentKinds, seedSalesStatusDictionaries } from './lib/dictionaries'
import { seedSalesTaxRates } from './lib/seeds'
import { ensureExamplePaymentMethods, ensureExampleShippingMethods } from './seed/examples-data'
import { seedSalesExamples } from './seed/examples'

const logger = cliLogger.forModule('sales')

function parseArgs(rest: string[]) {
  const { args } = parseCliArgs(rest, { string: ['tenant', 'org', 'count'] })
  return args as Record<string, string>
}

const seedTaxRatesCommand: ModuleCli = {
  command: 'seed-tax-rates',
  async run(rest) {
    const args = parseArgs(rest)
    const tenantId = String(args.tenantId ?? args.tenant ?? '')
    const organizationId = String(args.organizationId ?? args.org ?? args.orgId ?? '')
    if (!tenantId || !organizationId) {
      logger.error('Usage: mercato sales seed-tax-rates --tenant <tenantId> --org <organizationId>')
      return
    }
    const container = await createRequestContainer()
    const em = container.resolve('em') as EntityManager
    try {
      await em.transactional(async (tem) => {
        await seedSalesTaxRates(tem, { tenantId, organizationId })
      })
      logger.info('🧾 Tax rates seeded for organization', organizationId)
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
      logger.error('Usage: mercato sales seed-statuses --tenant <tenantId> --org <organizationId>')
      return
    }
    const container = await createRequestContainer()
    try {
      const em = container.resolve<EntityManager>('em')
      await em.transactional(async (tem) => {
        await seedSalesStatusDictionaries(tem, { tenantId, organizationId })
        await tem.flush()
      })
      logger.info('🚦 Sales order statuses seeded for organization', organizationId)
    } finally {
      const disposable = container as unknown as { dispose?: () => Promise<void> }
      if (typeof disposable.dispose === 'function') {
        await disposable.dispose()
      }
    }
  },
}

const seedAdjustmentKindsCommand: ModuleCli = {
  command: 'seed-adjustment-kinds',
  async run(rest) {
    const args = parseArgs(rest)
    const tenantId = String(args.tenantId ?? args.tenant ?? '')
    const organizationId = String(args.organizationId ?? args.org ?? args.orgId ?? '')
    if (!tenantId || !organizationId) {
      logger.error('Usage: mercato sales seed-adjustment-kinds --tenant <tenantId> --org <organizationId>')
      return
    }
    const container = await createRequestContainer()
    try {
      const em = container.resolve<EntityManager>('em')
      await em.transactional(async (tem) => {
        await seedSalesAdjustmentKinds(tem, { tenantId, organizationId })
        await tem.flush()
      })
      logger.info('⚙️  Sales adjustment kinds seeded for organization', organizationId)
    } finally {
      const disposable = container as unknown as { dispose?: () => Promise<void> }
      if (typeof disposable.dispose === 'function') {
        await disposable.dispose()
      }
    }
  },
}

const seedShippingMethodsCommand: ModuleCli = {
  command: 'seed-shipping-methods',
  async run(rest) {
    const args = parseArgs(rest)
    const tenantId = String(args.tenantId ?? args.tenant ?? '')
    const organizationId = String(args.organizationId ?? args.org ?? args.orgId ?? '')
    if (!tenantId || !organizationId) {
      logger.error('Usage: mercato sales seed-shipping-methods --tenant <tenantId> --org <organizationId>')
      return
    }
    const container = await createRequestContainer()
    try {
      const em = container.resolve<EntityManager>('em')
      await em.transactional(async (tem) => {
        await ensureExampleShippingMethods(tem, { tenantId, organizationId })
      })
      logger.info('🚚 Shipping methods seeded for organization', organizationId)
    } finally {
      const disposable = container as unknown as { dispose?: () => Promise<void> }
      if (typeof disposable.dispose === 'function') {
        await disposable.dispose()
      }
    }
  },
}

const seedPaymentMethodsCommand: ModuleCli = {
  command: 'seed-payment-methods',
  async run(rest) {
    const args = parseArgs(rest)
    const tenantId = String(args.tenantId ?? args.tenant ?? '')
    const organizationId = String(args.organizationId ?? args.org ?? args.orgId ?? '')
    if (!tenantId || !organizationId) {
      logger.error('Usage: mercato sales seed-payment-methods --tenant <tenantId> --org <organizationId>')
      return
    }
    const container = await createRequestContainer()
    try {
      const em = container.resolve<EntityManager>('em')
      await em.transactional(async (tem) => {
        await ensureExamplePaymentMethods(tem, { tenantId, organizationId })
      })
      logger.info('💳 Payment methods seeded for organization', organizationId)
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
      logger.error('Usage: mercato sales seed-examples --tenant <tenantId> --org <organizationId>')
      return
    }
    const container = await createRequestContainer()
    try {
      const em = container.resolve<EntityManager>('em')
      const seeded = await em.transactional(async (tem) =>
        seedSalesExamples(tem, container, { tenantId, organizationId })
      )
      if (seeded) {
        logger.info('🧾 Sales example quotes and orders seeded for organization', organizationId)
      } else {
        logger.info('Sales example data already present; skipping')
      }
    } finally {
      const disposable = container as unknown as { dispose?: () => Promise<void> }
      if (typeof disposable.dispose === 'function') {
        await disposable.dispose()
      }
    }
  },
}

export default [
  seedTaxRatesCommand,
  seedStatusesCommand,
  seedAdjustmentKindsCommand,
  seedShippingMethodsCommand,
  seedPaymentMethodsCommand,
  seedExamplesCommand,
]
