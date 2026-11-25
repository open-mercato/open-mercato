import { parseModuleCliOptions } from '@open-mercato/shared/lib/cli/parseModuleCliOptions'
import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { invalidateCrudCache } from '@open-mercato/shared/lib/crud/cache'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { EntityManager } from '@mikro-orm/postgresql'
import { resourcesResourceTypeRepairOptionsSchema } from './data/validators'
import { seedResourcesActivityTypes, seedResourcesAddressTypes, seedResourcesCapacityUnits, seedResourcesResourceExamples, type ResourcesSeedScope } from './lib/seeds'

function parseArgs(rest: string[]) {
  return parseModuleCliOptions(rest, { flagValue: undefined })
}

const seedCapacityUnitsCommand: ModuleCli = {
  command: 'seed-capacity-units',
  async run(rest) {
    const args = parseArgs(rest)
    const tenantId = String(args.tenantId ?? args.tenant ?? '')
    const organizationId = String(args.organizationId ?? args.org ?? args.orgId ?? '')
    if (!tenantId || !organizationId) {
      console.error('Usage: mercato resources seed-capacity-units --tenant <tenantId> --org <organizationId>')
      return
    }
    const container = await createRequestContainer()
    const scope: ResourcesSeedScope = { tenantId, organizationId }
    try {
      const em = container.resolve<EntityManager>('em')
      await em.transactional(async (tem) => {
        await seedResourcesCapacityUnits(tem, scope)
      })
      console.log('📏 Resources capacity units seeded for organization', organizationId)
    } finally {
      const disposable = container as unknown as { dispose?: () => Promise<void> }
      if (typeof disposable.dispose === 'function') {
        await disposable.dispose()
      }
    }
  },
}

const seedActivityTypesCommand: ModuleCli = {
  command: 'seed-activity-types',
  async run(rest) {
    const args = parseArgs(rest)
    const tenantId = String(args.tenantId ?? args.tenant ?? '')
    const organizationId = String(args.organizationId ?? args.org ?? args.orgId ?? '')
    if (!tenantId || !organizationId) {
      console.error('Usage: mercato resources seed-activity-types --tenant <tenantId> --org <organizationId>')
      return
    }
    const container = await createRequestContainer()
    const scope: ResourcesSeedScope = { tenantId, organizationId }
    try {
      const em = container.resolve<EntityManager>('em')
      await em.transactional(async (tem) => {
        await seedResourcesActivityTypes(tem, scope)
      })
      console.log('🗂️  Resources activity types seeded for organization', organizationId)
    } finally {
      const disposable = container as unknown as { dispose?: () => Promise<void> }
      if (typeof disposable.dispose === 'function') {
        await disposable.dispose()
      }
    }
  },
}

const seedAddressTypesCommand: ModuleCli = {
  command: 'seed-address-types',
  async run(rest) {
    const args = parseArgs(rest)
    const tenantId = String(args.tenantId ?? args.tenant ?? '')
    const organizationId = String(args.organizationId ?? args.org ?? args.orgId ?? '')
    if (!tenantId || !organizationId) {
      console.error('Usage: mercato resources seed-address-types --tenant <tenantId> --org <organizationId>')
      return
    }
    const container = await createRequestContainer()
    const scope: ResourcesSeedScope = { tenantId, organizationId }
    try {
      const em = container.resolve<EntityManager>('em')
      await em.transactional(async (tem) => {
        await seedResourcesAddressTypes(tem, scope)
      })
      console.log('🏠 Resources address types seeded for organization', organizationId)
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
      console.error('Usage: mercato resources seed-examples --tenant <tenantId> --org <organizationId>')
      return
    }
    const container = await createRequestContainer()
    const scope: ResourcesSeedScope = { tenantId, organizationId }
    try {
      const em = container.resolve<EntityManager>('em')
      await em.transactional(async (tem) => {
        await seedResourcesResourceExamples(tem, scope)
      })
      console.log('🧩 Resources example resources seeded for organization', organizationId)
    } finally {
      const disposable = container as unknown as { dispose?: () => Promise<void> }
      if (typeof disposable.dispose === 'function') {
        await disposable.dispose()
      }
    }
  },
}

const repairResourceTypeReferencesCommand: ModuleCli = {
  command: 'repair-resource-type-references',
  help: 'mercato resources repair-resource-type-references --tenant <tenantId> --org <organizationId> [--apply]',
  async run(rest) {
    const { tenant, org, apply = false } = resourcesResourceTypeRepairOptionsSchema.parse(parseModuleCliOptions(rest))
    const scope = { tenantId: tenant, organizationId: org }
    const { repairResourceTypeReferences } = await import('./commands/resources')
    const container = await createRequestContainer()
    try {
      const result = await repairResourceTypeReferences(
        container.resolve<EntityManager>('em'),
        container.resolve<DataEngine>('dataEngine'),
        scope,
        apply,
      )
      if (apply) await invalidateCrudCache(container, 'resources.resource', scope, tenant, 'resource-type-reference-repair')
      console.log(JSON.stringify({ mode: apply ? 'apply' : 'preview', ...result }))
    } finally {
      await container.dispose()
    }
  },
}

export default [
  seedCapacityUnitsCommand,
  seedActivityTypesCommand,
  seedAddressTypesCommand,
  seedExamplesCommand,
  repairResourceTypeReferencesCommand,
]
