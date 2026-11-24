import { createTranslator } from '@open-mercato/shared/lib/i18n/translate'
import en from '../../../i18n/en.json'
import pl from '../../../i18n/pl.json'
import { localizeIntegrationHealthMessage } from '../detail-page-health'

describe('integration health diagnostic localization', () => {
  const diagnostic = 'Gmail OAuth state secret is not configured'

  it('translates the stable missing-secret reason for a Polish operator', () => {
    expect(localizeIntegrationHealthMessage(
      diagnostic,
      { reason: 'missing_oauth_state_secret' },
      createTranslator(pl),
    )).toBe('Sekret stanu OAuth nie jest skonfigurowany.')
  })

  it('uses the English dictionary for the same stable reason', () => {
    expect(localizeIntegrationHealthMessage(
      diagnostic,
      { reason: 'missing_oauth_state_secret' },
      createTranslator(en),
    )).toBe('The OAuth state secret is not configured.')
  })

  it('preserves a provider diagnostic with an unknown reason', () => {
    expect(localizeIntegrationHealthMessage('Provider unavailable', { reason: 'provider_unavailable' }, createTranslator(pl)))
      .toBe('Provider unavailable')
  })

  it('preserves the absence of an unrelated message', () => {
    expect(localizeIntegrationHealthMessage(null, {}, createTranslator(pl))).toBeNull()
  })
})
