import { AssistedSellingStoreSettings } from '../../data/entities'
import {
  ASSISTED_SELLING_STORE_SETTINGS_DEFAULTS,
  toEffectiveAssistedSellingSettings,
} from '../settings'

describe('assisted_selling effective settings (§5.6)', () => {
  it('defaults to mode off with the §5.6 values when no row exists', () => {
    expect(toEffectiveAssistedSellingSettings(null)).toEqual({
      mode: 'off',
      proposalTtlSeconds: 259200,
      maxProposalLines: 50,
      conversationRetentionDays: 365,
      idleCloseDays: 30,
    })
  })

  it('returns a copy so callers cannot mutate the shared defaults', () => {
    const effective = toEffectiveAssistedSellingSettings(null)
    effective.mode = 'rep'
    expect(ASSISTED_SELLING_STORE_SETTINGS_DEFAULTS.mode).toBe('off')
  })

  it('exposes only the Release 5 fields of a stored row', () => {
    const row = Object.assign(new AssistedSellingStoreSettings(), {
      mode: 'rep',
      proposalTtlSeconds: 7200,
      maxProposalLines: 10,
      conversationRetentionDays: 90,
      idleCloseDays: 7,
      aiAgentUserId: '44444444-4444-4444-8444-444444444444',
    })
    expect(toEffectiveAssistedSellingSettings(row)).toEqual({
      mode: 'rep',
      proposalTtlSeconds: 7200,
      maxProposalLines: 10,
      conversationRetentionDays: 90,
      idleCloseDays: 7,
    })
  })

  it('defaults new entities to the same values as the migration', () => {
    const fresh = new AssistedSellingStoreSettings()
    expect(fresh.mode).toBe('off')
    expect(fresh.aiProposalsRequireRepApproval).toBe(false)
    expect(fresh.proposalTtlSeconds).toBe(259200)
    expect(fresh.maxProposalLines).toBe(50)
    expect(fresh.conversationRetentionDays).toBe(365)
    expect(fresh.idleCloseDays).toBe(30)
  })
})
