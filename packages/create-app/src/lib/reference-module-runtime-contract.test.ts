import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import type { CacheStrategy } from '@open-mercato/cache'
import {
  parseReferenceImportCsv,
  referenceImportRowId,
  REFERENCE_IMPORT_MAX_ROWS,
  validateReferenceImportRow,
} from '../../template/src/modules/reference_module/lib/task-import.js'
import {
  invalidateReferenceTaskCache,
  readReferenceTaskCache,
  writeReferenceTaskCache,
} from '../../template/src/modules/reference_module/lib/task-cache.js'
import {
  notificationHandlers,
  REFERENCE_TASK_REFRESH_EVENT,
} from '../../template/src/modules/reference_module/notifications.handlers.js'

const CREATE_APP_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const REFERENCE_ROOT = path.join(CREATE_APP_ROOT, 'template/src/modules/reference_module')

function source(relativePath: string): string {
  return fs.readFileSync(path.join(REFERENCE_ROOT, relativePath), 'utf8')
}

test('reference import parser is bounded, strict, quoted, and deterministic', () => {
  const scope = {
    tenantId: '00000000-0000-4000-8000-000000000010',
    organizationId: '00000000-0000-4000-8000-000000000020',
  }
  const rows = parseReferenceImportCsv([
    'title,description,status,priority,dueAt,isActive,source,targetKind,targetId',
    '"Review, safely","No secret output",in_progress,3,2026-08-03T09:00:00Z,true,manual,customer,00000000-0000-4000-8000-000000000001',
  ].join('\n'))
  assert.equal(rows.length, 1)
  const parsed = validateReferenceImportRow(rows[0])
  assert.equal(parsed.task.title, 'Review, safely')
  assert.equal(parsed.task.priority, 3)
  assert.deepEqual(parsed.target, {
    targetKind: 'customer',
    targetId: '00000000-0000-4000-8000-000000000001',
  })
  assert.throws(() => parseReferenceImportCsv('title,unknown\nTask,value'), /unknown header/)
  assert.equal(parseReferenceImportCsv('status,title\ntodo,Task')[0].title, 'Task')
  const tooManyRows = ['title', ...Array.from({ length: REFERENCE_IMPORT_MAX_ROWS + 1 }, (_, index) => `Task ${index}`)].join('\n')
  assert.throws(() => parseReferenceImportCsv(tooManyRows), /row limit/)
  assert.equal(referenceImportRowId(scope, 'same-key', 7), referenceImportRowId(scope, 'same-key', 7))
  assert.notEqual(referenceImportRowId(scope, 'same-key', 7), referenceImportRowId(scope, 'same-key', 8))
  assert.notEqual(referenceImportRowId(scope, 'same-key', 7), referenceImportRowId({ ...scope, tenantId: '00000000-0000-4000-8000-000000000011' }, 'same-key', 7))
  assert.notEqual(referenceImportRowId(scope, 'same-key', 7), referenceImportRowId({ ...scope, organizationId: '00000000-0000-4000-8000-000000000021' }, 'same-key', 7))
  assert.match(referenceImportRowId(scope, 'same-key', 7), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
})

test('reference cache partitions keys and invalidation tags by trusted scope', async () => {
  const values = new Map<string, unknown>()
  const sets: Array<{ key: string; tags: string[] }> = []
  const deletions: string[][] = []
  const cache: CacheStrategy = {
    async get(key) { return values.get(key) ?? null },
    async set(key, value, options) {
      values.set(key, value)
      sets.push({ key, tags: options?.tags ?? [] })
    },
    async has(key) { return values.has(key) },
    async delete(key) { return values.delete(key) },
    async deleteByTags(tags) { deletions.push(tags); return 1 },
    async clear() { const count = values.size; values.clear(); return count },
    async keys() { return [...values.keys()] },
    async stats() { return { size: values.size, expired: 0 } },
  }
  const container = { resolve: () => cache } as unknown as Parameters<typeof writeReferenceTaskCache>[0]
  const scope = {
    tenantId: '00000000-0000-4000-8000-000000000001',
    organizationId: '00000000-0000-4000-8000-000000000002',
  }
  await writeReferenceTaskCache(container, scope, 'list:one', { id: 'safe-id', title: 'Safe title' })
  assert.deepEqual(await readReferenceTaskCache(container, scope, 'list:one'), { id: 'safe-id', title: 'Safe title' })
  assert.match(sets[0].key, new RegExp(scope.organizationId))
  assert.ok(sets[0].tags.every((tag) => tag.includes(scope.tenantId) || tag.includes(scope.organizationId)))
  await invalidateReferenceTaskCache(container, scope)
  assert.deepEqual(deletions[0], sets[0].tags)

  const unavailableContainer = {
    resolve: () => ({
      ...cache,
      async get() { throw new Error('unavailable') },
      async set() { throw new Error('unavailable') },
      async deleteByTags() { throw new Error('unavailable') },
    }),
  } as unknown as Parameters<typeof writeReferenceTaskCache>[0]
  assert.equal(await readReferenceTaskCache(unavailableContainer, scope, 'list:one'), null)
  await writeReferenceTaskCache(unavailableContainer, scope, 'list:one', { id: 'safe-id' })
  await invalidateReferenceTaskCache(unavailableContainer, scope)
})

test('reference runtime discovery surfaces use platform contracts and exclude encrypted values', () => {
  const route = source('api/imports/route.ts')
  const tasksRoute = source('api/tasks/route.ts')
  const worker = source('workers/reference-task-import.ts')
  const events = source('events.ts')
  const notificationSubscriber = source('subscribers/reference-task-notifications.ts')
  assert.match(route, /REFERENCE_IMPORT_MAX_BYTES/)
  assert.match(route, /idempotency-key/)
  assert.match(route, /progressService\.createJob/)
  assert.match(tasksRoute, /total > 10_000/)
  assert.match(tasksRoute, /formats: \['csv' as const\]/)
  assert.doesNotMatch(tasksRoute.slice(tasksRoute.indexOf('columns:'), tasksRoute.indexOf('hooks:')), /description|targetLabel/)
  assert.match(worker, /isCancellationRequested/)
  assert.match(worker, /commandBus\.execute\('reference_module\.reference_task\.create'/)
  assert.match(worker, /markCancelled/)
  assert.match(events, /clientBroadcast: true/)
  assert.match(notificationSubscriber, /groupKey:/)
  assert.doesNotMatch(notificationSubscriber, /description|targetLabelSnapshot|payload\.csv/)
})

test('reference reactive handler emits one deduplicated refresh event without sensitive payloads', () => {
  const handler = notificationHandlers[0]
  const emitted: Array<{ name: string; detail: unknown }> = []
  let refreshes = 0
  handler.handle({
    id: 'notification-1',
    type: 'reference_module.import.completed',
    title: 'Complete',
    severity: 'success',
    status: 'unread',
    actions: [],
    createdAt: new Date().toISOString(),
  }, {
    features: ['reference_module.*'],
    currentPath: '/backend/reference_module/tasks',
    toast: () => undefined,
    popup: () => undefined,
    emitEvent: (name, detail) => emitted.push({ name, detail }),
    refreshNotifications: () => { refreshes += 1 },
    navigate: () => undefined,
    markAsRead: async () => undefined,
    dismiss: async () => undefined,
  })
  assert.deepEqual(emitted, [{
    name: REFERENCE_TASK_REFRESH_EVENT,
    detail: { notificationId: 'notification-1', taskId: null },
  }])
  assert.equal(refreshes, 1)
})
