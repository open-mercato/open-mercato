import { resolvePushConnectErrorMessage } from '../push-connect-error'
import enMessages from '../../i18n/en.json'

const dict = enMessages as Record<string, string>

// Mirrors the real `useT` contract: `dict[key] ?? fallback`.
const translate = (key: string, fallback: string): string => dict[key] ?? fallback

const GENERIC = dict['communication_channels.push.connect.failed']

describe('resolvePushConnectErrorMessage', () => {
  it('maps each error code the connect routes return to its localized message', () => {
    for (const code of [
      'provider_not_tenant_scoped',
      'mailbox_already_connected',
      'wrong_scope_for_route',
    ]) {
      const key = `communication_channels.push.connect.errors.${code}`
      // The locale file must ship the key so the failure path is not English-only.
      expect(dict[key]).toBeTruthy()
      const message = resolvePushConnectErrorMessage(translate, { code })
      expect(message).toBe(dict[key])
      expect(message).not.toBe(GENERIC)
    }
  })

  it('falls back to the generic message when the response carries no code', () => {
    expect(resolvePushConnectErrorMessage(translate, undefined)).toBe(GENERIC)
    expect(resolvePushConnectErrorMessage(translate, {})).toBe(GENERIC)
    expect(resolvePushConnectErrorMessage(translate, { code: null })).toBe(GENERIC)
  })

  it('falls back to the generic message for an unknown code (no matching key)', () => {
    expect(resolvePushConnectErrorMessage(translate, { code: 'totally_unknown_code' })).toBe(GENERIC)
  })
})
