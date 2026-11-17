import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import {
  clearGatewayAdapters,
  clearPaymentGatewayDescriptors,
  getGatewayAdapter,
  getPaymentGatewayDescriptor,
} from '@open-mercato/shared/modules/payment_gateways/types'
import { register } from '../di'

describe('gateway_tpay di registration', () => {
  afterEach(() => {
    clearPaymentGatewayDescriptors()
    clearGatewayAdapters()
  })

  it('declares the payer fields Tpay needs to create a transaction', () => {
    const container = { register: jest.fn() } as unknown as AppContainer

    register(container)

    expect(getGatewayAdapter('tpay')).toBeDefined()
    expect(getPaymentGatewayDescriptor('tpay')?.requiresPayerFields).toEqual(['email', 'name'])
  })
})
