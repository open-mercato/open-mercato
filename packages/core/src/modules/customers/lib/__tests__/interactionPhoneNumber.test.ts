import { mergeInteractionPhoneNumber } from '../interactionPhoneNumber'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (_key: string, fallback: string) => fallback }),
}))

describe('interaction phone-number writes', () => {
  it('leaves custom-only writes unchanged when the top-level phone is omitted', async () => {
    const custom = { callPhoneNumber: '+48229999999', callDirection: 'inbound' }
    expect(await mergeInteractionPhoneNumber(undefined, custom)).toBe(custom)
  })

  it('maps a top-level phone without losing other custom fields or mutating input', async () => {
    const custom = { callDirection: 'inbound' }
    expect(await mergeInteractionPhoneNumber('+48221234567', custom)).toEqual({
      callDirection: 'inbound', callPhoneNumber: '+48221234567',
    })
    expect(custom).toEqual({ callDirection: 'inbound' })
  })

  it.each(['+48221234567', ' +48221234567 '])('accepts matching duplicate %s', async (existing) => {
    expect(await mergeInteractionPhoneNumber('+48221234567', { callPhoneNumber: existing }))
      .toEqual({ callPhoneNumber: '+48221234567' })
  })

  it.each(['+48229999999', null, ['+48221234567']])('rejects a conflicting custom value %j', async (existing) => {
    await expect(mergeInteractionPhoneNumber('+48221234567', { callPhoneNumber: existing }))
      .rejects.toMatchObject({ status: 400, body: { fields: ['phoneNumber', 'customValues.callPhoneNumber'] } })
  })

  it('preserves an explicit null as a clear rather than an omitted write', async () => {
    expect(await mergeInteractionPhoneNumber(null, {})).toEqual({ callPhoneNumber: null })
  })
})
