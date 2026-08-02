import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { interceptors as apiInterceptors } from '../../template/src/modules/reference_module/api/interceptors.js'
import { interceptors as commandInterceptors } from '../../template/src/modules/reference_module/commands/interceptors.js'
import { classifyReferenceTaskDueDate } from '../../template/src/modules/reference_module/lib/due-state.js'
import { guards } from '../../template/src/modules/reference_module/data/guards.js'
import { eventsConfig } from '../../template/src/modules/reference_module/events.js'
import { searchConfig } from '../../template/src/modules/reference_module/search.js'

const CREATE_APP_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const REFERENCE_ROOT = path.join(CREATE_APP_ROOT, 'template/src/modules/reference_module')

function readReferenceFile(relativePath: string): string {
  return fs.readFileSync(path.join(REFERENCE_ROOT, relativePath), 'utf8')
}

test('reference events and search expose only safe scoped fields', async () => {
  const eventIds = eventsConfig.events.map((entry) => entry.id)
  assert.deepEqual(eventIds, [
    'reference_module.reference_task.created',
    'reference_module.reference_task.updated',
    'reference_module.reference_task.deleted',
    'reference_module.reference_task.restored',
    'reference_module.reference_task.linked',
    'reference_module.reference_task.unlinked',
    'reference_module.import.completed',
  ])
  assert.equal(eventsConfig.events.every((entry) => entry.clientBroadcast === true), true)

  const entity = searchConfig.entities[0]
  assert.equal(entity?.entityId, 'reference_module:reference_task')
  assert.deepEqual(entity?.aclFeatures, ['reference_module.view'])
  assert.deepEqual(entity?.fieldPolicy?.searchable, ['title', 'status'])
  assert.deepEqual(entity?.fieldPolicy?.excluded, ['description', 'target_label_snapshot', 'payload'])
  const source = await entity?.buildSource?.({
    record: { id: 'task-1', title: 'Safe title', status: 'todo', description: 'secret-description' },
    customFields: {},
  })
  assert.deepEqual(source?.text, ['Safe title', 'todo'])
  assert.doesNotMatch(JSON.stringify(source), /secret-description/)
})

test('reference guards and interceptors fail closed and honor wildcard-gated registries', async () => {
  assert.deepEqual(guards.map((guard) => guard.targetEntity), [
    'reference_module.reference_task',
    'reference_module.reference_task_link',
  ])
  const blockedScope = await guards[0]!.validate({
    tenantId: '', organizationId: null, userId: 'user-1', resourceKind: 'reference_module.reference_task', resourceId: null,
    operation: 'create', requestMethod: 'POST', requestHeaders: new Headers(), mutationPayload: {},
  })
  assert.equal(blockedScope.ok, false)
  const blockedPayload = await guards[0]!.validate({
    tenantId: 'tenant-1', organizationId: 'org-1', userId: 'user-1', resourceKind: 'reference_module.reference_task', resourceId: null,
    operation: 'create', requestMethod: 'POST', requestHeaders: new Headers(), mutationPayload: { tenantId: 'other' },
  })
  assert.equal(blockedPayload.ok, false)

  assert.deepEqual(commandInterceptors[0]?.features, ['reference_module.manage'])
  const commandResult = await commandInterceptors[0]?.beforeExecute?.(
    { title: '  Normalized  ' },
    {
      commandId: 'reference_module.reference_task.create',
      auth: { sub: 'user-1', tenantId: 'tenant-1', orgId: 'org-1' },
      selectedOrganizationId: 'org-1',
      container: {} as never,
    },
  )
  assert.deepEqual(commandResult?.modifiedInput, { title: 'Normalized' })
  assert.equal(apiInterceptors[0]?.targetRoute, 'reference_module/tasks')
  const apiResult = await apiInterceptors[0]?.before?.(
    { method: 'GET', url: '/api/reference_module/tasks', headers: {}, query: { linkTargetKind: 'customer' } },
    {} as never,
  )
  assert.equal(apiResult?.ok, false)
})

test('reference enrichment is deterministic, batched, scoped, and time-sensitive', () => {
  const now = new Date('2026-08-02T12:00:00Z')
  assert.equal(classifyReferenceTaskDueDate(null, now), 'none')
  assert.equal(classifyReferenceTaskDueDate('2026-08-01T23:59:59Z', now), 'overdue')
  assert.equal(classifyReferenceTaskDueDate('2026-08-02T18:00:00Z', now), 'today')
  assert.equal(classifyReferenceTaskDueDate('2026-08-03T00:00:00Z', now), 'future')
  const source = readReferenceFile('data/enrichers.ts')
  assert.match(source, /targetEntity:\s*'reference_module\.reference_task'/)
  assert.match(source, /cacheableOnListHit:\s*false/)
  assert.match(source, /async enrichMany\(/)
  assert.match(source, /queryEngine:\s*\{ enabled: true, engines: \['basic', 'hybrid'\], applyOn: \['list', 'detail'\] \}/)
})

test('reference workflow files use canonical callers and redact finite undo metadata', () => {
  const commands = readReferenceFile('commands/tasks.ts')
  const route = readReferenceFile('api/tasks/route.ts')
  const routeContext = readReferenceFile('api/context.ts')
  assert.match(route, /makeCrudRoute\(/)
  assert.match(route, /entityId:\s*REFERENCE_TASK_ENTITY_ID/)
  assert.match(route, /buildCustomFieldFiltersFromQuery/)
  assert.match(route, /findWithDecryption/)
  assert.match(commands, /runCrudCommandWrite/)
  assert.match(commands, /enforceCommandOptimisticLockWithGuards/)
  assert.match(commands, /findOneWithDecryption/)
  assert.match(commands, /expiresAt:\s*undoExpiry/)
  assert.match(commands, /undoSnapshot\.consumedAt\s*=\s*now/)
  assert.match(commands, /payload:\s*\{ undo: \{ snapshotId \}/)
  assert.doesNotMatch(commands.match(/function logMetadata[\s\S]*?\n\}/)?.[0] ?? '', /description|targetLabelSnapshot/)
  assert.match(routeContext, /runMutationGuards/)
  assert.match(routeContext, /getAllMutationGuardInstances/)
  assert.doesNotMatch(commands, /from ['"][^'"]*customers|from ['"][^'"]*catalog|from ['"][^'"]*sales/)
})
