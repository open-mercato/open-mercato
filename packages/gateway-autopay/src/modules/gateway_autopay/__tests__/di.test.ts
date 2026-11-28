import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import {
  clearGatewayAdapters,
  clearPaymentGatewayDescriptors,
  getGatewayAdapter,
  getPaymentGatewayDescriptor,
} from '@open-mercato/shared/modules/payment_gateways/types'
import { register } from '../di'

describe('gateway_autopay di registration', () => {
  afterEach(() => {
    clearPaymentGatewayDescriptors()
    clearGatewayAdapters()
  })

  it('declares the payer email Autopay requires on every session', () => {
    const container = { register: jest.fn() } as unknown as AppContainer

    register(container)

    expect(getGatewayAdapter('autopay')).toBeDefined()
    expect(getPaymentGatewayDescriptor('autopay')?.requiresPayerFields).toEqual(['email'])
  })

  it('registers the PLN-only descriptor with the health check', () => {
    const registered: Record<string, unknown> = {}
    const container = {
      register: jest.fn((entries: Record<string, unknown>) => Object.assign(registered, entries)),
    } as unknown as AppContainer

    register(container)

    expect(getPaymentGatewayDescriptor('autopay')?.sessionConfig?.supportedCurrencies).toEqual(['PLN'])
    expect(Object.keys(registered)).toContain('autopayHealthCheck')
  })
})
