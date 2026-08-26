import { parseScopedCommandInput } from '@open-mercato/shared/lib/api/scoped'
import { collectWritableKeys, inspectWritePayload } from '@open-mercato/shared/lib/crud/write-payload'
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
    expect(parsed.ignoredFields).toBeUndefined()
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
    expect(parsed.ignoredFields).toEqual([{ key: 'not_a_deal_field', reason: 'unknown' }])
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
