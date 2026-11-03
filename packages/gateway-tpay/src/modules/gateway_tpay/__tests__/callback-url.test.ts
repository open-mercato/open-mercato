import { resolveTpayNotificationUrl } from '../lib/callback-url'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (key: string) => `translated:${key}` }),
}))

describe('resolveTpayNotificationUrl', () => {
  it.each([undefined, null, '', '   '])('returns null when unset (%p)', async (credential) => {
    await expect(resolveTpayNotificationUrl({ credential, environment: 'production' })).resolves.toBeNull()
  })

  it.each([
    ['https://shop.example.com/api/tpay/notify', 'production'],
    ['https://shop.example.com:443/notify', 'production'],
    ['https://shop.example.com/notify', 'sandbox'],
    ['http://shop.example.com/notify', 'sandbox'],
    ['http://shop.example.com:8080/notify', 'sandbox'],
    ['https://shop.example.com:8080/notify', 'sandbox'],
    ['https://shop.example.com:443/notify', 'sandbox'],
  ] as const)('accepts %s in %s', async (credential, environment) => {
    await expect(resolveTpayNotificationUrl({ credential, environment })).resolves.toBe(credential)
  })

  it.each([
    ['http://shop.example.com/notify', 'production'],
    ['https://shop.example.com:8443/notify', 'production'],
    ['https://shop.example.com:8080/notify', 'production'],
    ['https://user:pass@shop.example.com/notify', 'production'],
    ['https://user@shop.example.com/notify', 'sandbox'],
    ['https://shop.example.com/notify?x=1', 'production'],
    ['https://shop.example.com/notify?', 'production'],
    ['https://shop.example.com/notify#frag', 'sandbox'],
    ['https://shop.example.com:3000/notify', 'sandbox'],
    ['ftp://shop.example.com/notify', 'sandbox'],
    ['not a url', 'sandbox'],
  ] as const)('rejects %s in %s', async (credential, environment) => {
    await expect(resolveTpayNotificationUrl({ credential, environment })).rejects.toMatchObject({
      status: 422,
      body: { code: 'gateway_tpay.errors.invalidNotificationUrl' },
    })
  })

  it('rejects a non-string credential', async () => {
    await expect(resolveTpayNotificationUrl({ credential: 42, environment: 'sandbox' })).rejects.toMatchObject({
      status: 422,
    })
  })
})
