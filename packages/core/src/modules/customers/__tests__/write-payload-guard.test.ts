import { parseScopedCommandInput } from '@open-mercato/shared/lib/api/scoped'
import { collectWritableKeys, IGNORED_FIELDS, inspectWritePayload } from '@open-mercato/shared/lib/crud/write-payload'
import { activityUpdateSchema, dealUpdateSchema } from '../data/validators'

const translate = (_key: string, fallback?: string) => fallback ?? _key
const ctx = {
  auth: { tenantId: '11111111-1111-4111-8111-111111111111', orgId: '22222222-2222-4222-8222-222222222222' },
  selectedOrganizationId: '22222222-2222-4222-8222-222222222222',
} as any

const DEAL_ID = 'b55529cc-364a-466a-9134-d6a01a2380c5'
const ACTIVITY_ID = 'e356a1cf-8ec9-4c8c-9d9b-491436dd03a0'
const OTHER_ENTITY_ID = '04d233d7-e747-4789-a928-33f272c467fc'

// The deal list endpoint emits snake_case (`closure_outcome`, `loss_notes`,
// `owner_user_id`). A caller that reads a deal and writes it back therefore sends
// snake_case, which Zod stripped — the update answered 200 having applied `status`
// and discarded the other two.
describe('deal update accepts the spelling the read endpoints emit', () => {
  it('applies closure_outcome and loss_notes instead of dropping them', () => {
    const parsed = parseScopedCommandInput(
      dealUpdateSchema,
      {
        id: DEAL_ID,
        status: 'closed',
        closure_outcome: 'lost',
        loss_notes: 'client went with an incumbent vendor',
      },
      ctx,
      translate
    ) as Record<string, unknown>

    expect(parsed.status).toBe('closed')
    expect(parsed.closureOutcome).toBe('lost')
    expect(parsed.lossNotes).toBe('client went with an incumbent vendor')
    expect((parsed as any)[IGNORED_FIELDS]).toBeUndefined()
  })

  it('aliases owner_user_id, which the list endpoint also emits', () => {
    const parsed = parseScopedCommandInput(
      dealUpdateSchema,
      { id: DEAL_ID, owner_user_id: OTHER_ENTITY_ID },
      ctx,
      translate
    ) as Record<string, unknown>

    expect(parsed.ownerUserId).toBe(OTHER_ENTITY_ID)
  })

  it('names any field it will not write instead of answering a bare ok', () => {
    const parsed = parseScopedCommandInput(
      dealUpdateSchema,
      { id: DEAL_ID, status: 'closed', not_a_deal_field: 'x' },
      ctx,
      translate
    ) as Record<string, unknown>

    expect(parsed.status).toBe('closed')
    expect((parsed as any)[IGNORED_FIELDS]).toEqual([{ key: 'not_a_deal_field', reason: 'unknown' }])
  })
})

// Scope keys are derived from context, and `withScopedPayload` injects
// `organizationId` before the guard runs. A record round-tripped from a list that
// emitted `organization_id` therefore arrives with both spellings present, and on
// the "all organizations" selection the injected value legitimately differs from
// the record's. Inspecting them turned a working request into a 400.
describe('scope keys survive a round trip', () => {
  it('accepts a body carrying the organization_id and tenant_id a list emitted', () => {
    const allOrgs = {
      auth: { tenantId: '11111111-1111-4111-8111-111111111111', orgId: '22222222-2222-4222-8222-222222222222' },
      selectedOrganizationId: null,
    } as any
    const parsed = parseScopedCommandInput(
      dealUpdateSchema,
      {
        id: DEAL_ID,
        status: 'open',
        organization_id: '33333333-3333-4333-8333-333333333333',
        tenant_id: '11111111-1111-4111-8111-111111111111',
      },
      allOrgs,
      translate
    ) as Record<string, unknown>

    expect(parsed.status).toBe('open')
    // Scope still comes from context, never from the body's snake_case spelling.
    expect(parsed.organizationId).toBe('22222222-2222-4222-8222-222222222222')
    expect((parsed as any)[IGNORED_FIELDS]).toBeUndefined()
  })
})

// `z.coerce.number()` maps null to 0 and `z.coerce.date()` maps it to the epoch,
// so before the schemas accepted null a client that read a deal with no value set
// and wrote it straight back zeroed the amount and backdated the close date.
describe('a null from the read side clears rather than fabricating a value', () => {
  // Every `CustomerDeal` column that is `nullable: true`. `pipelineId` and
  // `pipelineStageId` matter beyond the coercion: they are the two that reach
  // `resolvePipelineAssignment` rather than a straight `?? null` assignment.
  it.each([
    ['valueAmount'],
    ['expectedCloseAt'],
    ['probability'],
    ['description'],
    ['closureOutcome'],
    ['lossNotes'],
    ['pipelineStage'],
    ['pipelineId'],
    ['pipelineStageId'],
    ['valueCurrency'],
    ['source'],
    ['lossReasonId'],
  ])('%s: null stays null', (field) => {
    const parsed = parseScopedCommandInput(
      dealUpdateSchema,
      { id: DEAL_ID, [field]: null },
      ctx,
      translate
    ) as Record<string, unknown>
    expect(parsed[field]).toBeNull()
  })

  it('still rejects null for status, whose column is not nullable', () => {
    expect(() => parseScopedCommandInput(dealUpdateSchema, { id: DEAL_ID, status: null }, ctx, translate)).toThrow()
  })
})

// The list projection emits `created_at` and `updated_at`, which no write schema
// declares. Reporting them would put two ignored fields on every round-trip write.
describe('server-maintained timestamps are not reported as ignored', () => {
  it('a body carrying created_at and updated_at reports nothing', () => {
    const parsed = parseScopedCommandInput(
      dealUpdateSchema,
      { id: DEAL_ID, status: 'open', created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-02-02T00:00:00.000Z' },
      ctx,
      translate
    ) as Record<string, unknown>
    expect(parsed.status).toBe('open')
    expect((parsed as any)[IGNORED_FIELDS]).toBeUndefined()
  })
})

// An interaction's owning entity is fixed at creation: `interactionUpdateSchema`
// declares no `entityId`, so the activities adapter had no way to apply one and
// reported success anyway.
describe('activity update refuses to pretend it re-parented a record', () => {
  it('no longer declares entityId as writable', () => {
    const keys = collectWritableKeys(activityUpdateSchema)
    expect(keys).not.toBeNull()
    expect(keys!.has('entityId')).toBe(false)
  })

  it('flags entityId as immutable rather than unknown', () => {
    const result = inspectWritePayload(
      { id: ACTIVITY_ID, entityId: OTHER_ENTITY_ID },
      collectWritableKeys(activityUpdateSchema),
      { immutableFields: ['entityId'] }
    )
    expect(result.unwritable).toEqual([{ key: 'entityId', reason: 'immutable' }])
  })

  it('still accepts the fields the canonical interaction update can apply', () => {
    const keys = collectWritableKeys(activityUpdateSchema)!
    for (const key of ['date', 'time', 'phoneNumber', 'subject', 'body', 'occurredAt', 'dealId']) {
      expect(keys.has(key)).toBe(true)
    }
  })
})
