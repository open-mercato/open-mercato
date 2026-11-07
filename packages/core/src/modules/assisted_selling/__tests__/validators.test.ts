import {
  assistedSellingReleaseModeSchema,
  assistedSellingStoreSettingsSaveSchema,
  assistedSellingStoreSettingsUpdateSchema,
} from '../data/validators'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const STORE_ID = '33333333-3333-4333-8333-333333333333'

describe('assisted_selling release-mode validator (S10, D-R5-15)', () => {
  test('accepts rep and off', () => {
    expect(assistedSellingReleaseModeSchema.safeParse('rep').success).toBe(true)
    expect(assistedSellingReleaseModeSchema.safeParse('off').success).toBe(true)
  })

  test('refuses ai and both — the enum values stay reserved for Phase 3', () => {
    expect(assistedSellingReleaseModeSchema.safeParse('ai').success).toBe(false)
    expect(assistedSellingReleaseModeSchema.safeParse('both').success).toBe(false)
  })
})

describe('assisted_selling store settings update schema (§5.6)', () => {
  test('accepts the five Release 5-exposed fields', () => {
    const parsed = assistedSellingStoreSettingsUpdateSchema.safeParse({
      mode: 'rep',
      proposalTtlSeconds: 3600,
      maxProposalLines: 10,
      conversationRetentionDays: 90,
      idleCloseDays: 7,
    })
    expect(parsed.success).toBe(true)
  })

  test('rejects mode: ai / both even inside the update body', () => {
    expect(assistedSellingStoreSettingsUpdateSchema.safeParse({ mode: 'ai' }).success).toBe(false)
    expect(assistedSellingStoreSettingsUpdateSchema.safeParse({ mode: 'both' }).success).toBe(false)
  })

  test('is .strict(): a body carrying an ai_* field is refused, not silently dropped', () => {
    const parsed = assistedSellingStoreSettingsUpdateSchema.safeParse({
      mode: 'rep',
      aiProposalsRequireRepApproval: true,
    })
    expect(parsed.success).toBe(false)
  })

  test('rejects an out-of-bounds proposalTtlSeconds (S5 bounds: 3600-1209600)', () => {
    expect(assistedSellingStoreSettingsUpdateSchema.safeParse({ proposalTtlSeconds: 60 }).success).toBe(false)
    expect(assistedSellingStoreSettingsUpdateSchema.safeParse({ proposalTtlSeconds: 99999999 }).success).toBe(false)
  })
})

describe('assisted_selling store settings save schema (scoping)', () => {
  test('requires tenantId, organizationId and storeId', () => {
    expect(assistedSellingStoreSettingsSaveSchema.safeParse({ mode: 'rep' }).success).toBe(false)
    expect(
      assistedSellingStoreSettingsSaveSchema.safeParse({
        tenantId: TENANT_ID,
        organizationId: ORG_ID,
        storeId: STORE_ID,
        mode: 'rep',
      }).success,
    ).toBe(true)
  })

  test('still refuses mode: ai / both once scoped', () => {
    const parsed = assistedSellingStoreSettingsSaveSchema.safeParse({
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      storeId: STORE_ID,
      mode: 'both',
    })
    expect(parsed.success).toBe(false)
  })
})
