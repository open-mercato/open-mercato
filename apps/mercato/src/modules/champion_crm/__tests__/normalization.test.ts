import { normalizeEmail, normalizeIntakePayload, normalizeName, normalizePhoneE164ish } from '../lib/normalization'

describe('champion_crm normalization', () => {
  it('normalizes email, Polish phone, and split name inputs', () => {
    expect(normalizeEmail('  LEAD@Example.COM  ')).toBe('lead@example.com')
    expect(normalizePhoneE164ish('501 222 333')).toBe('+48501222333')
    expect(normalizeName(null, ' Ada ', '  Nowak ')).toBe('Ada Nowak')
  })

  it('normalizes intake payload aliases and consents', () => {
    const normalized = normalizeIntakePayload({
      source: ' web ',
      source_external_id: ' EXT-1 ',
      email: 'Buyer@Example.com',
      phone_e164: '+48 501 222 333',
      utm: { campaign: ' Spring ' },
      consents: [{ scope: 'marketing_email', granted: true, text_version: 'v1' }],
    })

    expect(normalized).toMatchObject({
      source: 'web',
      sourceExternalId: 'EXT-1',
      emailNormalized: 'buyer@example.com',
      phoneE164: '+48501222333',
      utmCampaign: 'Spring',
    })
    expect(normalized.consents).toHaveLength(1)
    expect(normalized.consents[0]).toMatchObject({ scope: 'marketing_email', granted: true, textVersion: 'v1' })
  })
})

