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

  test('refuses ai and both — reserved for Phase 3', () => {
    expect(assistedSellingReleaseModeSchema.safeParse('ai').success).toBe(false)
    expect(assistedSellingReleaseModeSchema.safeParse('both').success).toBe(false)
  })
})

describe('assisted_selling store settings update schema (§5.6)', () => {
  test('accepts the five Release 5 fields at their bounds', () => {
    const lower = assistedSellingStoreSettingsUpdateSchema.safeParse({
      mode: 'rep',
      proposalTtlSeconds: 3600,
      maxProposalLines: 1,
      conversationRetentionDays: 1,
      idleCloseDays: 1,
    })
    const upper = assistedSellingStoreSettingsUpdateSchema.safeParse({
      mode: 'off',
      proposalTtlSeconds: 1209600,
      maxProposalLines: 100,
      conversationRetentionDays: 3650,
      idleCloseDays: 365,
    })
    expect(lower.success).toBe(true)
    expect(upper.success).toBe(true)
  })

  test('accepts an empty JSON object', () => {
    expect(assistedSellingStoreSettingsUpdateSchema.safeParse({}).success).toBe(true)
  })

  test('rejects mode ai and both', () => {
    expect(assistedSellingStoreSettingsUpdateSchema.safeParse({ mode: 'ai' }).success).toBe(false)
    expect(assistedSellingStoreSettingsUpdateSchema.safeParse({ mode: 'both' }).success).toBe(false)
  })

  test.each([
    'aiProposalsRequireRepApproval',
    'aiMaxProposalsPerThreadPerHour',
    'aiMaxTurnsPerThreadPerHour',
    'aiAgentUserId',
  ])('is strict: %s is refused, not dropped', (field) => {
    expect(assistedSellingStoreSettingsUpdateSchema.safeParse({ mode: 'rep', [field]: true }).success).toBe(false)
  })

  test.each([
    ['proposalTtlSeconds', 3599],
    ['proposalTtlSeconds', 1209601],
    ['maxProposalLines', 0],
    ['maxProposalLines', 101],
    ['conversationRetentionDays', 0],
    ['conversationRetentionDays', 3651],
    ['idleCloseDays', 0],
    ['idleCloseDays', 366],
  ])('rejects %s = %d outside its §5.6 bounds', (field, value) => {
    expect(assistedSellingStoreSettingsUpdateSchema.safeParse({ [field]: value }).success).toBe(false)
  })

  test('rejects a non-integer value', () => {
    expect(assistedSellingStoreSettingsUpdateSchema.safeParse({ maxProposalLines: 10.5 }).success).toBe(false)
  })

  test.each([
    ['proposalTtlSeconds', 3600],
    ['maxProposalLines', 1],
    ['conversationRetentionDays', 1],
    ['idleCloseDays', 1],
  ])('requires a JSON number for %s', (field, value) => {
    for (const invalid of [true, [value], String(value), null]) {
      expect(assistedSellingStoreSettingsUpdateSchema.safeParse({ [field]: invalid }).success).toBe(false)
    }
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

  test('still refuses mode both once scoped', () => {
    const parsed = assistedSellingStoreSettingsSaveSchema.safeParse({
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      storeId: STORE_ID,
      mode: 'both',
    })
    expect(parsed.success).toBe(false)
  })
})
