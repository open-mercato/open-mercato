import { createHash } from 'node:crypto'
import type { AwilixContainer } from 'awilix'
import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { installCustomEntitiesFromModules } from '@open-mercato/core/modules/entities/lib/install-from-ce'
import { seedExampleTodos } from './cli'
import { EXAMPLE_TODO_BULK_DISPATCH_QUEUE } from './lib/todoBulkComplete'
import {
  EXAMPLE_CALENDAR_ENTITY_ID,
  EXAMPLE_SETUP_ENTITY_IDS,
  buildCalendarReferenceRecords,
} from './lib/exampleSeeds'

/**
 * The three setup hooks are not three flavours of "seed something". They differ in
 * what the framework hands them and when it calls them, and this module uses each for
 * the job only it can do:
 *
 * - `onTenantCreated` receives an `EntityManager` and NO container, and fires the
 *   moment a tenant exists — including tenants created long after `mercato init`. It
 *   installs the module's custom-entity/field DEFINITIONS: pure `em` work, and the
 *   precondition for everything below.
 * - `seedDefaults` receives the container, runs on `mercato init` and on
 *   `mercato seed:defaults`, and is never skipped. It writes scoped reference RECORDS
 *   through the DI-resolved `dataEngine` — which `onTenantCreated` could not do,
 *   because there is no container to resolve it from there.
 * - `seedExamples` also receives the container but is skipped by `--no-examples`. It is
 *   the only hook allowed to create demo domain rows, and it delegates to the same
 *   `seedExampleTodos` the module CLI exposes so both entry points seed identically.
 *
 * All three are idempotent: the installer upserts definitions, the reference records
 * carry deterministic ids that upsert, and the todo seeder returns early once the scope
 * already has todos.
 */
const logger = createLogger('example').child({ component: 'setup' })

type SchedulerServiceLike = {
  register: (registration: Record<string, unknown>) => Promise<void>
}

function stableScheduleUuid(stableKey: string): string {
  const hex = createHash('sha256').update(stableKey).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

/**
 * Registers the outbox-recovery tick for the Todo bulk-complete operation.
 *
 * Lives in `seedDefaults` because that is the only always-running hook that
 * receives a container — `onTenantCreated` gets an `EntityManager` and nothing
 * else, so a scheduler target cannot be registered from there.
 *
 * Returns `false` (rather than throwing) when the scheduler module is absent, and
 * `registerTodoBulkDispatchSchedule`'s caller swallows every other failure. The
 * scheduler enforces a per-tenant active-schedule cap and rejects the write with a
 * 422 once it is reached; that must degrade to a logged warning, because tenant
 * initialization failing over an optional recovery tick would be a far worse
 * outcome than the tick being missing.
 */
export async function registerTodoBulkDispatchSchedule(
  container: AwilixContainer | undefined,
  scope: { tenantId: string; organizationId: string },
): Promise<boolean> {
  if (!container) return false
  const cradle = container as { hasRegistration?: (name: string) => boolean }
  if (typeof cradle.hasRegistration !== 'function' || !cradle.hasRegistration('schedulerService')) {
    return false
  }

  const schedulerService = container.resolve('schedulerService') as SchedulerServiceLike
  await schedulerService.register({
    id: stableScheduleUuid(`example:todos-bulk-dispatch:${scope.tenantId}:${scope.organizationId}`),
    name: 'Todo bulk-complete outbox dispatch',
    description: 'Republish unpublished or lease-expired Todo bulk-complete operations.',
    scopeType: 'organization',
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    scheduleType: 'interval',
    scheduleValue: '5m',
    timezone: 'UTC',
    targetType: 'queue',
    targetQueue: EXAMPLE_TODO_BULK_DISPATCH_QUEUE,
    targetPayload: scope,
    sourceType: 'module',
    sourceModule: 'example',
    isEnabled: true,
  })
  return true
}

async function ensureTodoBulkDispatchSchedule(
  container: AwilixContainer | undefined,
  scope: { tenantId: string; organizationId: string },
): Promise<void> {
  try {
    await registerTodoBulkDispatchSchedule(container, scope)
  } catch (error) {
    logger.warn('Failed to register the todo bulk-complete dispatch schedule', { err: error })
  }
}

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['example.*', 'payment_gateways.*', 'shipping_carriers.*'],
    admin: ['example.*', 'payment_gateways.*', 'shipping_carriers.*'],
    employee: ['example.*', 'example.widgets.*', 'payment_gateways.view', 'shipping_carriers.view'],
  },

  async onTenantCreated({ em, tenantId }) {
    // `null` cache on purpose: there is no container to resolve one from here, and a
    // tenant that did not exist a moment ago has nothing cached to invalidate.
    await installCustomEntitiesFromModules(em, null, {
      entityIds: [...EXAMPLE_SETUP_ENTITY_IDS],
      tenantIds: [tenantId],
      includeGlobal: false,
    })
  },

  async seedDefaults({ container, tenantId, organizationId }) {
    const dataEngine = container.resolve<DataEngine>('dataEngine')
    for (const record of buildCalendarReferenceRecords({ tenantId, organizationId })) {
      await dataEngine.createCustomEntityRecord({
        entityId: EXAMPLE_CALENDAR_ENTITY_ID,
        recordId: record.recordId,
        tenantId,
        organizationId,
        values: record.values,
        // Reference rows are not a user action; emitting a per-row update event on
        // every init would broadcast noise nobody subscribed for.
        notify: false,
      })
    }
    await ensureTodoBulkDispatchSchedule(container, { tenantId, organizationId })
  },

  async seedExamples({ em, container, tenantId, organizationId }) {
    await seedExampleTodos(em, container as AppContainer, { organizationId, tenantId })
  },
}

export default setup
