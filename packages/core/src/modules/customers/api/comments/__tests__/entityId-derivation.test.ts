/**
 * Coverage for the dealId-only comment creation contract (#5345):
 * POST /api/customers/comments accepts dealId without entityId and derives
 * the timeline entity from the deal's links.
 *
 * The schema layer imports the real `commentCreateSchema`, and the derivation
 * layer imports the REAL shared helper from commands/shared.ts (which has no
 * `#generated` imports), driven by a mock EntityManager that interprets the
 * helper's own orderBy/limit options over in-memory rows. Only the final
 * `mapInput` block is a local mirror: route.ts imports `#generated` files and
 * cannot be loaded in jest, so that block verifies the branch order against a
 * mirror, not the real route module.
 */

import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { commentCreateSchema, COMMENT_TARGET_REQUIRED_MESSAGE_KEY } from '../../../data/validators'
import { resolveDealCommentEntityId } from '../../../commands/shared'
import { CustomerDeal, CustomerDealPersonLink } from '../../../data/entities'

const ORG_ID = '22222222-2222-4222-8222-222222222222'
const TENANT_ID = '33333333-3333-4333-8333-333333333333'
const ENTITY_ID = '11111111-1111-4111-8111-111111111111'
const DEAL_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const PERSON_A = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const PERSON_B = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const COMPANY_A = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const COMPANY_B = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'

const basePayload = {
  organizationId: ORG_ID,
  tenantId: TENANT_ID,
  body: 'A note body',
}

const translate = (key: string, _fallback: string) => key

const scope = { tenantId: TENANT_ID, organizationId: ORG_ID }

type CommentCreatePayload = z.infer<typeof commentCreateSchema>

type MockRow = Record<string, unknown>

type OrderClause = Record<string, 'asc' | 'desc'>

type CapturedQuery = {
  entity: unknown
  where: Record<string, unknown>
  options?: { orderBy?: OrderClause[]; limit?: number }
}

function compareValues(left: unknown, right: unknown): number {
  if (left instanceof Date && right instanceof Date) return left.getTime() - right.getTime()
  if (typeof left === 'boolean' && typeof right === 'boolean') return Number(left) - Number(right)
  return String(left).localeCompare(String(right))
}

/**
 * Interprets whatever orderBy/limit the helper passes over in-memory rows —
 * generic MikroORM semantics, NOT a copy of the expected ordering, so a wrong
 * orderBy spec in the helper fails these tests.
 */
function sortByOrderClauses(rows: MockRow[], orderBy: OrderClause[]): MockRow[] {
  return [...rows].sort((left, right) => {
    for (const clause of orderBy) {
      for (const [field, direction] of Object.entries(clause)) {
        const compared = compareValues(left[field], right[field])
        if (compared !== 0) return direction === 'desc' ? -compared : compared
      }
    }
    return 0
  })
}

function createMockEm(config: {
  deal?: MockRow | null
  personLinks?: MockRow[]
  companyLinks?: MockRow[]
}) {
  const findOneCalls: CapturedQuery[] = []
  const findCalls: CapturedQuery[] = []
  const em = {
    findOne: async (entity: unknown, where: Record<string, unknown>) => {
      findOneCalls.push({ entity, where })
      return config.deal ?? null
    },
    find: async (
      entity: unknown,
      where: Record<string, unknown>,
      options?: { orderBy?: OrderClause[]; limit?: number },
    ) => {
      findCalls.push({ entity, where, options })
      const rows = entity === CustomerDealPersonLink ? (config.personLinks ?? []) : (config.companyLinks ?? [])
      const ordered = sortByOrderClauses(rows, options?.orderBy ?? [])
      return typeof options?.limit === 'number' ? ordered.slice(0, options.limit) : ordered
    },
  }
  return { em: em as unknown as EntityManager, findOneCalls, findCalls }
}

const dealRow: MockRow = { id: DEAL_ID, tenantId: TENANT_ID, organizationId: ORG_ID }

function personLinkRow(id: string, personEntityId: string, isPrimary: boolean, createdAt: string): MockRow {
  return { id, isPrimary, createdAt: new Date(createdAt), person: { id: personEntityId } }
}

function companyLinkRow(id: string, companyEntityId: string, createdAt: string): MockRow {
  return { id, createdAt: new Date(createdAt), company: { id: companyEntityId } }
}

describe('commentCreateSchema target requirement (#5345)', () => {
  it('accepts a payload with dealId and no entityId', () => {
    const result = commentCreateSchema.safeParse({ ...basePayload, dealId: DEAL_ID })
    expect(result.success).toBe(true)
  })

  it('accepts a payload with entityId and no dealId', () => {
    const result = commentCreateSchema.safeParse({ ...basePayload, entityId: ENTITY_ID })
    expect(result.success).toBe(true)
  })

  it('rejects a payload with neither entityId nor dealId', () => {
    const result = commentCreateSchema.safeParse({ ...basePayload })
    expect(result.success).toBe(false)
    if (result.success) return
    const issue = result.error.issues.find(
      (candidate) => candidate.path.length === 1 && candidate.path[0] === 'entityId',
    )
    expect(issue?.message).toBe(COMMENT_TARGET_REQUIRED_MESSAGE_KEY)
  })

  it('rejects a malformed dealId at the schema level', () => {
    const result = commentCreateSchema.safeParse({ ...basePayload, dealId: 'not-a-uuid' })
    expect(result.success).toBe(false)
    if (result.success) return
    const issue = result.error.issues.find(
      (candidate) => candidate.path.length === 1 && candidate.path[0] === 'dealId',
    )
    expect(issue).toBeDefined()
  })

  it('rejects a malformed entityId at the schema level', () => {
    const result = commentCreateSchema.safeParse({ ...basePayload, entityId: 'not-a-uuid' })
    expect(result.success).toBe(false)
    if (result.success) return
    const issue = result.error.issues.find(
      (candidate) => candidate.path.length === 1 && candidate.path[0] === 'entityId',
    )
    expect(issue).toBeDefined()
  })
})

describe('resolveDealCommentEntityId shared helper (#5345)', () => {
  it('prefers a primary person over an earlier non-primary person', async () => {
    const { em } = createMockEm({
      deal: dealRow,
      personLinks: [
        personLinkRow('00000000-0000-0000-0000-000000000001', PERSON_A, false, '2026-01-01T00:00:00Z'),
        personLinkRow('00000000-0000-0000-0000-000000000002', PERSON_B, true, '2026-02-01T00:00:00Z'),
      ],
    })
    await expect(resolveDealCommentEntityId(em, DEAL_ID, scope, translate)).resolves.toBe(PERSON_B)
  })

  it('falls back to the earliest-created person when none is primary', async () => {
    const { em } = createMockEm({
      deal: dealRow,
      personLinks: [
        personLinkRow('00000000-0000-0000-0000-000000000002', PERSON_B, false, '2026-02-01T00:00:00Z'),
        personLinkRow('00000000-0000-0000-0000-000000000001', PERSON_A, false, '2026-01-01T00:00:00Z'),
      ],
    })
    await expect(resolveDealCommentEntityId(em, DEAL_ID, scope, translate)).resolves.toBe(PERSON_A)
  })

  it('breaks a createdAt tie by lower id', async () => {
    const { em } = createMockEm({
      deal: dealRow,
      personLinks: [
        personLinkRow('00000000-0000-0000-0000-000000000002', PERSON_B, false, '2026-01-01T00:00:00Z'),
        personLinkRow('00000000-0000-0000-0000-000000000001', PERSON_A, false, '2026-01-01T00:00:00Z'),
      ],
    })
    await expect(resolveDealCommentEntityId(em, DEAL_ID, scope, translate)).resolves.toBe(PERSON_A)
  })

  it('prefers any person link over all company links', async () => {
    const { em } = createMockEm({
      deal: dealRow,
      personLinks: [
        personLinkRow('00000000-0000-0000-0000-000000000001', PERSON_A, false, '2026-03-01T00:00:00Z'),
      ],
      companyLinks: [
        companyLinkRow('00000000-0000-0000-0000-000000000003', COMPANY_A, '2026-01-01T00:00:00Z'),
      ],
    })
    await expect(resolveDealCommentEntityId(em, DEAL_ID, scope, translate)).resolves.toBe(PERSON_A)
  })

  it('falls back to the earliest-created company when no person is linked', async () => {
    const { em } = createMockEm({
      deal: dealRow,
      companyLinks: [
        companyLinkRow('00000000-0000-0000-0000-000000000004', COMPANY_B, '2026-02-01T00:00:00Z'),
        companyLinkRow('00000000-0000-0000-0000-000000000003', COMPANY_A, '2026-01-01T00:00:00Z'),
      ],
    })
    await expect(resolveDealCommentEntityId(em, DEAL_ID, scope, translate)).resolves.toBe(COMPANY_A)
  })

  it('throws a 422 when the deal has no linked person or company', async () => {
    const { em } = createMockEm({ deal: dealRow })
    await expect(resolveDealCommentEntityId(em, DEAL_ID, scope, translate)).rejects.toMatchObject({
      status: 422,
      body: { error: 'customers.errors.deal_entity_link_missing' },
    })
  })

  it('throws a 400 before querying links when the deal is missing or out of scope', async () => {
    const { em, findCalls } = createMockEm({ deal: null })
    await expect(resolveDealCommentEntityId(em, DEAL_ID, scope, translate)).rejects.toMatchObject({
      status: 400,
      body: { error: 'customers.errors.deal_not_found' },
    })
    expect(findCalls).toHaveLength(0)
  })

  it('scopes the deal lookup by tenant, organization, and soft-delete', async () => {
    const { em, findOneCalls } = createMockEm({
      deal: dealRow,
      personLinks: [
        personLinkRow('00000000-0000-0000-0000-000000000001', PERSON_A, false, '2026-01-01T00:00:00Z'),
      ],
    })
    await resolveDealCommentEntityId(em, DEAL_ID, scope, translate)
    expect(findOneCalls).toHaveLength(1)
    expect(findOneCalls[0].entity).toBe(CustomerDeal)
    expect(findOneCalls[0].where).toEqual({
      id: DEAL_ID,
      deletedAt: null,
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
    })
  })
})

/**
 * MIRROR, not real-path coverage: route.ts imports `#generated` files and
 * cannot be loaded in jest, so the mapInput branch order (parse first,
 * explicit-entityId short-circuit, derive only for dealId-only payloads)
 * is mirrored locally against the real schema.
 */
async function mapCreateInputMirror(
  payload: Record<string, unknown>,
  derive: (dealId: string) => Promise<string>,
): Promise<CommentCreatePayload> {
  const parsed = commentCreateSchema.parse(payload)
  if (parsed.entityId || !parsed.dealId) return parsed
  return { ...parsed, entityId: await derive(parsed.dealId) }
}

describe('mapInput branch order mirror (#5345)', () => {
  it('keeps an explicit entityId and never invokes derivation', async () => {
    const derive = jest.fn<Promise<string>, [string]>().mockResolvedValue(PERSON_A)
    const result = await mapCreateInputMirror(
      { ...basePayload, entityId: ENTITY_ID, dealId: DEAL_ID },
      derive,
    )
    expect(result.entityId).toBe(ENTITY_ID)
    expect(derive).not.toHaveBeenCalled()
  })

  it('rejects a malformed dealId before derivation runs', async () => {
    const derive = jest.fn<Promise<string>, [string]>().mockResolvedValue(PERSON_A)
    await expect(
      mapCreateInputMirror({ ...basePayload, dealId: 'not-a-uuid' }, derive),
    ).rejects.toBeInstanceOf(z.ZodError)
    expect(derive).not.toHaveBeenCalled()
  })

  it('derives entityId for a dealId-only payload', async () => {
    const derive = jest.fn<Promise<string>, [string]>().mockResolvedValue(PERSON_A)
    const result = await mapCreateInputMirror({ ...basePayload, dealId: DEAL_ID }, derive)
    expect(derive).toHaveBeenCalledWith(DEAL_ID)
    expect(result.entityId).toBe(PERSON_A)
    expect(result.dealId).toBe(DEAL_ID)
    expect(result.body).toBe(basePayload.body)
  })
})
