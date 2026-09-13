/**
 * The board's drag (`PATCH /api/staff/timesheets/tasks/[id]/status`) runs
 * `staff.timesheets.tasks.status_change` straight from the route, so nothing in
 * `makeCrudRoute` gets to flush the cached tasks list afterwards. The command bus
 * flushes by the audit `resourceKind` (`staff.timesheets.task`), which is NOT the
 * tag the list is stored under, so the move has to declare that tag itself.
 *
 * Without it, `ENABLE_CRUD_API_CACHE=true` (the ephemeral QA environment and the
 * integration suite both run with it on) answered the board's post-move refetch
 * with the pre-move page: the card snapped back to its old column with no error,
 * and the stale `updated_at` that page carried made the next move answer 409
 * "changed by someone else" until the entry expired.
 */

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (_key: string, fallback: string) => fallback }),
}))

import { commandRegistry, type CommandLogMetadata, type CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import {
  buildCollectionTags,
  canonicalizeResourceTag,
  expandResourceAliases,
} from '@open-mercato/shared/lib/crud/cache'
import { staffTimeTaskCrudEvents } from '../lib/crud'
import { staffTimeTaskCommandIds } from '../commands/timesheets-tasks'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORGANIZATION_ID = '22222222-2222-4222-8222-222222222222'
const TASK_ID = '33333333-3333-4333-8333-333333333333'

const taskRow = {
  id: TASK_ID,
  tenantId: TENANT_ID,
  organizationId: ORGANIZATION_ID,
  timeProjectId: '44444444-4444-4444-8444-444444444444',
  parentTaskId: null,
  taskStatusId: '55555555-5555-4555-8555-555555555555',
  sequenceNumber: 7,
  reference: 'NRD-7',
  title: 'Migracja koszyka B2B',
  description: null,
  assigneeStaffMemberId: null,
  position: 500,
  createdByUserId: null,
  closedAt: null,
  deletedAt: null,
}

const snapshotBefore = {
  ...taskRow,
  taskStatusId: '66666666-6666-4666-8666-666666666666',
  position: 1000,
  closedAt: null,
  deletedAt: null,
}

function buildContext(): CommandRuntimeContext {
  const em = {
    fork: () => em,
    findOne: async () => taskRow,
    find: async () => [],
  }
  return {
    container: { resolve: (name: string) => (name === 'em' ? em : null) },
    auth: { sub: 'user-1', tenantId: TENANT_ID, orgId: ORGANIZATION_ID },
    selectedOrganizationId: ORGANIZATION_ID,
    organizationIds: [ORGANIZATION_ID],
  } as unknown as CommandRuntimeContext
}

/** What `makeCrudRoute` tags a cached page of `/api/staff/timesheets/tasks` with. */
function tasksListCollectionTag(): string {
  const resource = canonicalizeResourceTag(
    `${staffTimeTaskCrudEvents.module}.${staffTimeTaskCrudEvents.entity}`,
  )
  return buildCollectionTags(resource as string, TENANT_ID, [ORGANIZATION_ID])[0]
}

/** What `invalidateCrudCache` clears for the metadata a command hands the bus. */
function tagsClearedFor(metadata: CommandLogMetadata): Set<string> {
  const context = (metadata.context ?? {}) as { cacheAliases?: unknown }
  const aliases = Array.isArray(context.cacheAliases)
    ? context.cacheAliases.filter((entry): entry is string => typeof entry === 'string')
    : []
  const targets = expandResourceAliases(String(metadata.resourceKind), aliases)
  const tags = new Set<string>()
  for (const target of targets) {
    for (const tag of buildCollectionTags(target, TENANT_ID, [null, ORGANIZATION_ID])) tags.add(tag)
  }
  return tags
}

describe('the board move flushes the tasks list it refetches', () => {
  it('clears the very collection tag the tasks CRUD route caches its pages under', async () => {
    const handler = commandRegistry.get(staffTimeTaskCommandIds.statusChange)
    expect(handler?.buildLog).toBeDefined()

    const metadata = await handler!.buildLog!({
      input: { id: TASK_ID, taskStatusId: taskRow.taskStatusId },
      result: undefined,
      ctx: buildContext(),
      snapshots: { before: { snapshot: snapshotBefore } },
    } as never)

    expect(metadata).toBeTruthy()
    expect(tagsClearedFor(metadata as CommandLogMetadata)).toContain(tasksListCollectionTag())
  })

  it('keeps writing the audit resource kind the other task commands write', async () => {
    const handler = commandRegistry.get(staffTimeTaskCommandIds.statusChange)
    const metadata = await handler!.buildLog!({
      input: { id: TASK_ID, taskStatusId: taskRow.taskStatusId },
      result: undefined,
      ctx: buildContext(),
      snapshots: { before: { snapshot: snapshotBefore } },
    } as never)

    // The alias is additive: the audit trail is unchanged, only the cache reach grows.
    expect((metadata as CommandLogMetadata).resourceKind).toBe('staff.timesheets.task')
  })
})
