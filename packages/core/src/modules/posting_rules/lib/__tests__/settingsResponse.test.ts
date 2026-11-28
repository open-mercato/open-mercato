import { buildSettingsPatch, unwrapSettingsResult } from '../settingsResponse'

const CLEARING = '11111111-1111-4111-8111-111111111111'
const UNALLOCATED = '22222222-2222-4222-8222-222222222222'
const OTHER = '33333333-3333-4333-8333-333333333333'

describe('unwrapSettingsResult', () => {
  it('reads the settings from the { ok, result } body the settings route returns', () => {
    const body = {
      ok: true,
      result: { settingsId: 'settings-1', clearingAccountId: CLEARING, unallocatedCostAccountId: null, updatedAt: '2026-10-20T10:00:00.000Z' },
    }
    expect(unwrapSettingsResult(body)).toEqual({
      settingsId: 'settings-1',
      clearingAccountId: CLEARING,
      unallocatedCostAccountId: null,
      updatedAt: '2026-10-20T10:00:00.000Z',
    })
  })

  it('does not treat the envelope itself as the settings', () => {
    const settings = unwrapSettingsResult({ ok: true, result: { clearingAccountId: CLEARING } })
    expect(settings?.clearingAccountId).toBe(CLEARING)
    expect(unwrapSettingsResult({ clearingAccountId: CLEARING })).toBeNull()
  })

  it('returns null for a body without settings', () => {
    expect(unwrapSettingsResult(null)).toBeNull()
    expect(unwrapSettingsResult({ error: 'Forbidden' })).toBeNull()
  })
})

describe('buildSettingsPatch', () => {
  const current = { clearingAccountId: CLEARING, unallocatedCostAccountId: UNALLOCATED }

  it('sends only the field that changed, so the other account is never overwritten with null', () => {
    expect(buildSettingsPatch(current, { clearingAccountId: OTHER, unallocatedCostAccountId: UNALLOCATED })).toEqual({
      clearingAccountId: OTHER,
    })
  })

  it('sends nothing when nothing changed', () => {
    expect(buildSettingsPatch(current, { clearingAccountId: CLEARING, unallocatedCostAccountId: UNALLOCATED })).toEqual({})
  })

  it('sends null when the user clears a field', () => {
    expect(buildSettingsPatch(current, { clearingAccountId: '', unallocatedCostAccountId: UNALLOCATED })).toEqual({
      clearingAccountId: null,
    })
  })
})
