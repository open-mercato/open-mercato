import { getPaymentGatewayDescriptor, getGatewayAdapter } from '@open-mercato/shared/modules/payment_gateways/types'
import { integration, integrations, bundles } from '../integration'
import { register } from '../di'
import { tpayAdapterV1 } from '../lib/adapters/v1'
import { tpayHealthCheck } from '../lib/health'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (_key: string, fallback: string) => fallback }),
}))

describe('gateway_tpay integration definition', () => {
  it('declares a payment gateway integration', () => {
    expect(integrations).toEqual([integration])
    expect(bundles).toEqual([])
    expect(integration).toMatchObject({
      id: 'gateway_tpay',
      category: 'payment',
      hub: 'payment_gateways',
      providerKey: 'tpay',
      package: '@open-mercato/gateway-tpay',
      healthCheck: { service: 'tpayHealthCheck' },
    })
    expect(integration.apiVersions).toEqual([expect.objectContaining({ id: 'v1', default: true })])
  })

  it('declares credential fields with expected keys, types and required flags', () => {
    const fields = integration.credentials?.fields.map((field) => [field.key, field.type, field.required ?? false])
    expect(fields).toEqual([
      ['clientId', 'text', true],
      ['clientSecret', 'secret', true],
      ['environment', 'select', true],
      ['notificationUrl', 'url', false],
      ['notificationSecurityCode', 'secret', false],
    ])
    const environment = integration.credentials?.fields.find((field) => field.key === 'environment')
    expect(environment && 'options' in environment ? environment.options.map((option) => option.value) : []).toEqual([
      'sandbox',
      'production',
    ])
  })
})

describe('gateway_tpay DI registration', () => {
  it('registers the adapter, a redirect-only PLN descriptor and the health check', () => {
    const registered: Record<string, unknown> = {}
    register({ register: (entries: Record<string, { resolve: () => unknown }>) => {
      for (const [key, value] of Object.entries(entries)) registered[key] = value.resolve()
    } } as never)

    expect(getGatewayAdapter('tpay', 'v1')).toBe(tpayAdapterV1)
    expect(registered.tpayHealthCheck).toBe(tpayHealthCheck)

    const descriptor = getPaymentGatewayDescriptor('tpay')
    expect(descriptor?.label).toBe('Tpay')
    expect(descriptor?.sessionConfig?.presentation).toBe('redirect')
    expect(descriptor?.sessionConfig?.supportedCurrencies).toEqual(['PLN'])
    expect(descriptor?.sessionConfig?.renderers).toBeUndefined()
    expect(descriptor?.sessionConfig?.embeddedRenderers).toBeUndefined()
  })
})
