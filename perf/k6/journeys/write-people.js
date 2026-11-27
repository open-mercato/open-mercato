import { get, request } from '../lib/http.js'
import { rememberCreated, sampleEmailPrefix, sampleTag, scopeIds, writeTarget } from '../lib/catalog.js'
import { currentUser } from '../lib/auth.js'
import { vuRng } from '../lib/random.js'
import { pickOne, randomInt } from '../lib/pure/prng.js'
import { think } from '../lib/think.js'
import { hasFeature } from '../lib/features.js'
import { check } from 'k6'

export const OPTIMISTIC_LOCK_HEADER = 'x-om-ext-optimistic-lock-expected-updated-at'

const INTERACTION_TYPES = ['note', 'call', 'task']
const INTERACTIONS_MANAGE = 'customers.interactions.manage'
const CITIES = ['Warsaw', 'Krakow', 'Berlin', 'Lyon', 'Porto', 'Gdansk']

function token(length = 6) {
  const rng = vuRng()
  let text = ''
  for (let index = 0; index < length; index += 1) text += String.fromCharCode(97 + Math.floor(rng() * 26))
  return text
}

function entityTarget() {
  return vuRng() < 0.75 ? writeTarget('people') : writeTarget('companies')
}

export function interactionBody(entityId, interactionType) {
  const now = Date.now()
  const user = currentUser()
  const base = {
    ...scopeIds(),
    entityId,
    interactionType,
    title: `perf ${interactionType} ${token()}`,
    body: `perf generated ${interactionType} ${token(12)}`,
    authorUserId: user && user.userId ? user.userId : undefined,
  }
  if (interactionType === 'task') {
    return { ...base, status: 'planned', scheduledAt: new Date(now + 3 * 24 * 3600 * 1000).toISOString(), ownerUserId: base.authorUserId }
  }
  return { ...base, status: 'done', occurredAt: new Date(now).toISOString() }
}

function logNote(entityId) {
  return request({
    method: 'POST',
    path: '/api/customers/comments',
    body: { ...scopeIds(), entityId, body: `perf note ${token(16)}` },
    name: 'write.interaction:note',
    expect: 'id',
  })
}

export function logInteractionJourney() {
  const target = entityTarget()
  if (!target) return
  if (!hasFeature(INTERACTIONS_MANAGE)) {
    logNote(target.id)
    return
  }
  const interactionType = pickOne(vuRng(), INTERACTION_TYPES)
  const created = request({
    method: 'POST',
    path: '/api/customers/interactions',
    body: interactionBody(target.id, interactionType),
    name: 'write.interaction:create',
    expect: 'id',
  })
  if (!created.ok) return
  request(get('/api/customers/interactions', {
    entityId: target.id,
    limit: 50,
    sortField: 'activityDate',
    sortDir: 'desc',
    excludeInteractionType: 'task',
  }, 'write.interaction:timeline', 'items'))
}

export function editPersonJourney() {
  const target = writeTarget('people')
  if (!target) return
  const detail = request(get(`/api/customers/people/${target.id}`, null, 'write.person.edit:detail', 'person.id'))
  const body = detail.ok ? detail.json() : null
  const updatedAt = body && body.person ? body.person.updatedAt : null
  if (!updatedAt) return
  think()
  request({
    method: 'PUT',
    path: '/api/customers/people',
    body: { ...scopeIds(), id: target.id, jobTitle: `Perf ${token(8)}` },
    headers: { [OPTIMISTIC_LOCK_HEADER]: updatedAt },
    name: 'write.person.edit:update',
    expect: 'ok',
    conflict: true,
  })
}

export function createPersonJourney() {
  const firstName = `Perf${token(5)}`
  const lastName = `Load${token(6)}`
  const prefix = sampleEmailPrefix() || 'perf'
  const created = request({
    method: 'POST',
    path: '/api/customers/people',
    body: {
      ...scopeIds(),
      firstName,
      lastName,
      displayName: `${firstName} ${lastName}`,
      primaryEmail: `${prefix}.${token(8)}@perf.example.test`,
    },
    name: 'write.person.create:create',
    expect: 'id',
  })
  const body = created.ok ? created.json() : null
  if (!body || !body.id) return
  rememberCreated('people', body.id)
  request({
    method: 'POST',
    path: '/api/customers/addresses',
    body: {
      ...scopeIds(),
      entityId: body.id,
      addressLine1: `${randomInt(vuRng(), 1, 300)} Perf Street`,
      city: pickOne(vuRng(), CITIES),
      postalCode: `${randomInt(vuRng(), 10000, 99999)}`,
      country: 'PL',
      isPrimary: true,
    },
    name: 'write.person.create:address',
    expect: 'id',
  })
}

export function assignTagJourney() {
  const target = entityTarget()
  const tagId = sampleTag()
  if (!target || !tagId) return
  request({
    method: 'POST',
    path: '/api/customers/tags/assign',
    body: { ...scopeIds(), tagId, entityId: target.id },
    name: 'write.tag.assign:assign',
    expect: 'object',
    accept: [409],
  })
}

function openTaskId(entityId) {
  const result = request(get('/api/customers/interactions/tasks', { page: 1, pageSize: 20, entityId }, 'write.task.complete:tasks', 'items'))
  const body = result.ok ? result.json() : null
  const items = body && Array.isArray(body.items) ? body.items : []
  const open = items.find((item) => item && item.todoIsDone === false && (item.todoSource === undefined || String(item.todoSource).includes('interaction')))
  return open ? open.todoId : null
}

function createTask(entityId) {
  const created = request({
    method: 'POST',
    path: '/api/customers/interactions',
    body: interactionBody(entityId, 'task'),
    name: 'write.task.complete:create',
    expect: 'id',
  })
  const body = created.ok ? created.json() : null
  return body ? body.id : null
}

export function completeTaskJourney() {
  const permitted = hasFeature(INTERACTIONS_MANAGE)
  check(null, { 'write.task.complete permitted': () => permitted }, { strict: '0', name: 'write.task.complete:permission', group: 'write', journey: 'write.task.complete' })
  if (!permitted) return
  const target = writeTarget('people')
  if (!target) return
  const taskId = openTaskId(target.id) || createTask(target.id)
  if (!taskId) return
  request({
    method: 'POST',
    path: '/api/customers/interactions/complete',
    body: { id: taskId, occurredAt: new Date().toISOString() },
    name: 'write.task.complete:complete',
    expect: 'object',
    conflict: true,
  })
}
