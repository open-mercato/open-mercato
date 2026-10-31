/** @jest-environment node */

import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import type { ConversationShareGrant } from '../../../../lib/conversationShares'

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const viewerId = '33333333-3333-4333-8333-333333333333'
const coworkerId = '44444444-4444-4444-8444-444444444444'
const personId = '55555555-5555-4555-8555-555555555555'
const channelId = '66666666-6666-4666-8666-666666666666'

type Candidate = {
  id: string
  title: string
  tenant_id: string
  organization_id: string
  author_user_id: string
  owner_user_id: string | null
  entity_id: string
  channel_id: string | null
  interaction_type: string
  visibility: string | null
  scheduled_at: string
  duration_minutes: number | null
  status: string
  deleted_at: string | null
}

type Predicate = (row: Candidate) => boolean
type ExpressionBuilder = {
  (column: unknown, operator: string, value: unknown): Predicate
  or: (predicates: Predicate[]) => Predicate
  and: (predicates: Predicate[]) => Predicate
  val: (value: boolean) => Predicate
}

const expressionBuilder: ExpressionBuilder = Object.assign(
  (column: unknown, operator: string, value: unknown): Predicate => (row) => {
    const actual = typeof column === 'string'
      ? row[column as keyof Candidate]
      : new Date(new Date(row.scheduled_at).getTime() + (row.duration_minutes ?? 30) * 60_000).toISOString()
    switch (operator) {
      case '=': case 'is': return actual === value
      case '!=': return actual !== null && actual !== value
      case 'is not': return actual !== value
      case 'in': return Array.isArray(value) && value.includes(actual)
      case 'not in': return Array.isArray(value) && !value.includes(actual)
      case '<': return String(actual) < String(value)
      case '>': return String(actual) > String(value)
      default: throw new Error(`[internal] Unsupported test operator: ${operator}`)
    }
  },
  {
    or: (predicates: Predicate[]): Predicate => (row) => predicates.some((predicate) => predicate(row)),
    and: (predicates: Predicate[]): Predicate => (row) => predicates.every((predicate) => predicate(row)),
    val: (value: boolean): Predicate => () => value,
  },
)

let candidates: Candidate[] = []
let predicates: Predicate[] = []
let rowLimit = Infinity
let auth: AuthContext
let shareGrants: ConversationShareGrant[] = []
let sharedChannelIds: string[] = []

const queryBuilder = {
  select: jest.fn().mockReturnThis(),
  where: jest.fn((column: unknown, operator?: string, value?: unknown) => {
    predicates.push(typeof column === 'function'
      ? (column as (builder: ExpressionBuilder) => Predicate)(expressionBuilder)
      : expressionBuilder(column, operator ?? '=', value))
    return queryBuilder
  }),
  orderBy: jest.fn().mockReturnThis(),
  limit: jest.fn((limit: number) => {
    rowLimit = limit
    return queryBuilder
  }),
  execute: jest.fn(async () => candidates.filter((row) => predicates.every((predicate) => predicate(row))).slice(0, rowLimit)),
}
const em = { getKysely: () => ({ selectFrom: () => queryBuilder }) }

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({ resolve: () => ({ fork: () => em }) })),
}))
jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => auth),
}))
jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn(async () => ({ selectedId: organizationId, filterIds: [organizationId] })),
}))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({ translate: (_key: string, fallback: string) => fallback })),
}))
jest.mock('../../../../lib/conversationShares', () => ({
  listGrantsForViewer: jest.fn(async (_em: unknown, _scope: unknown, viewer: string | null) => viewer ? shareGrants : []),
  listSharedChannelIds: jest.fn(async (_em: unknown, _scope: unknown, viewer: string | null) => viewer ? sharedChannelIds : []),
}))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(async (_em: unknown, _entity: unknown, filter: { id: { $in: string[] } }) =>
    candidates.filter((row) => filter.id.$in.includes(row.id)).map((row) => ({ id: row.id, title: row.title }))),
}))

import { GET } from '../route'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { listGrantsForViewer, listSharedChannelIds } from '../../../../lib/conversationShares'

function candidate(id: string, overrides: Partial<Candidate> = {}): Candidate {
  return {
    id, title: `PRIVATE SUBJECT ${id}`, tenant_id: tenantId, organization_id: organizationId,
    author_user_id: coworkerId, owner_user_id: viewerId, entity_id: personId, channel_id: null,
    interaction_type: 'email', visibility: 'private', scheduled_at: '2026-10-04T09:00:00.000Z',
    duration_minutes: 30, status: 'planned', deleted_at: null, ...overrides,
  }
}

async function lookup(userId?: string) {
  const params = new URLSearchParams({ date: '2026-10-04', startTime: '09:00', duration: '30' })
  if (userId) params.set('userId', userId)
  const response = await GET(new Request(`http://localhost/api/customers/interactions/conflicts?${params}`))
  expect(response.status).toBe(200)
  return response.json() as Promise<{ result: { hasConflicts: boolean; conflicts: Array<{ id: string; title: string | null }> } }>
}

describe('scheduling conflict email visibility', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    candidates = []
    predicates = []
    rowLimit = Infinity
    shareGrants = []
    sharedChannelIds = []
    auth = { sub: viewerId, tenantId, orgId: organizationId }
  })

  it('defaults interactive scheduling to sub and preserves author and owner matches', async () => {
    candidates = [
      candidate('authored', { author_user_id: viewerId, owner_user_id: null }),
      candidate('owned', { interaction_type: 'meeting' }),
      candidate('unrelated', { interaction_type: 'meeting', owner_user_id: null }),
    ]
    expect((await lookup()).result.conflicts.map((row) => row.id)).toEqual(['authored', 'owned'])
  })

  it('filters private email before selection and decryption during an explicit coworker lookup', async () => {
    candidates = [candidate('hidden')]
    expect((await lookup(coworkerId)).result).toEqual({ hasConflicts: false, conflicts: [] })
    expect(findWithDecryption).not.toHaveBeenCalled()
  })

  it.each([
    ['per-message sharing', { visibility: 'shared' }],
    ['legacy email', { visibility: null }],
    ['non-email interaction', { interaction_type: 'meeting' }],
  ])('preserves %s in a coworker lookup', async (_name, overrides) => {
    candidates = [candidate('visible', overrides)]
    expect((await lookup(coworkerId)).result.conflicts).toEqual([
      expect.objectContaining({ id: 'visible', title: 'PRIVATE SUBJECT visible' }),
    ])
  })

  it('uses viewer-scoped conversation grants without sharing sibling conversations', async () => {
    shareGrants = [{ personEntityId: personId, ownerUserId: coworkerId }]
    candidates = [candidate('shared'), candidate('sibling', { entity_id: channelId })]
    expect((await lookup(coworkerId)).result.conflicts.map((row) => row.id)).toEqual(['shared'])
    expect(listGrantsForViewer).toHaveBeenCalledWith(em, { tenantId, organizationId }, viewerId)
  })

  it('honors shared channels without exposing the same author’s private mailbox', async () => {
    sharedChannelIds = [channelId]
    candidates = [candidate('shared', { channel_id: channelId }), candidate('private-mailbox')]
    expect((await lookup(coworkerId)).result.conflicts.map((row) => row.id)).toEqual(['shared'])
    expect(listSharedChannelIds).toHaveBeenCalledWith(em, { tenantId, organizationId }, viewerId)
  })

  it.each([viewerId, undefined])('keeps API keys without viewer access (creator %s)', async (creatorId) => {
    auth = { sub: `api_key:${channelId}`, isApiKey: true, userId: creatorId, tenantId, orgId: organizationId }
    shareGrants = [{ personEntityId: personId, ownerUserId: viewerId }]
    sharedChannelIds = [channelId]
    candidates = [
      candidate('creator-private', { author_user_id: viewerId, channel_id: channelId }),
      candidate('shared', { author_user_id: viewerId, visibility: 'shared' }),
    ]
    expect((await lookup()).result.conflicts.map((row) => row.id)).toEqual(['shared'])
    expect(listGrantsForViewer).toHaveBeenCalledWith(em, { tenantId, organizationId }, null)
    expect(listSharedChannelIds).toHaveBeenCalledWith(em, { tenantId, organizationId }, null)
  })

  it('retains API-key creator scheduling scope and permits an explicit scheduling subject', async () => {
    auth = { sub: `api_key:${channelId}`, isApiKey: true, userId: viewerId, tenantId, orgId: organizationId }
    candidates = [
      candidate('creator', { author_user_id: viewerId, owner_user_id: null, visibility: 'shared' }),
      candidate('coworker', { owner_user_id: null, visibility: 'shared' }),
    ]
    expect((await lookup()).result.conflicts.map((row) => row.id)).toEqual(['creator'])
    predicates = []
    expect((await lookup(coworkerId)).result.conflicts.map((row) => row.id)).toEqual(['coworker'])
  })

  it('filters before the result limit and retains organization and tenant scoping', async () => {
    candidates = [
      ...Array.from({ length: 10 }, (_value, index) => candidate(`hidden-${index}`)),
      candidate('wrong-tenant', { tenant_id: personId, visibility: 'shared' }),
      candidate('wrong-org', { organization_id: personId, visibility: 'shared' }),
      candidate('visible', { visibility: 'shared' }),
    ]
    expect((await lookup()).result.conflicts.map((row) => row.id)).toEqual(['visible'])
    expect(findWithDecryption).toHaveBeenCalledWith(em, expect.anything(), {
      id: { $in: ['visible'] }, tenantId, organizationId, deletedAt: null,
    }, undefined, { tenantId, organizationId })
  })
})
