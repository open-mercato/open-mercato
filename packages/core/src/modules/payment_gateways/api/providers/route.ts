import { NextResponse } from 'next/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { paymentGatewaysTag } from '../openapi'

type PaymentGatewayDescriptorService = {
  list: () => Array<{
    providerKey: string
    label: string
    sessionConfig?: {
      fields?: Array<{
        key: string
        label: string
        type: string
        description?: string
        required?: boolean
        options?: Array<{ value: string; label: string }>
      }>
      supportedCurrencies?: '*' | string[]
      supportedPaymentTypes?: Array<{ value: string; label: string }>
      presentation?: 'embedded' | 'redirect' | 'either'
    }
  }>
}

export const metadata = {
  path: '/payment_gateways/providers',
  GET: { requireAuth: true, requireFeatures: ['payment_gateways.view'] },
}

export async function GET() {
  const { resolve } = await createRequestContainer()
  const descriptorService = resolve('paymentGatewayDescriptorService') as PaymentGatewayDescriptorService
  return NextResponse.json({ items: descriptorService.list() })
}

export const openApi = {
  tags: [paymentGatewaysTag],
  summary: 'List payment gateway descriptors',
  methods: {
    GET: {
      summary: 'List payment gateway descriptors',
      tags: [paymentGatewaysTag],
      responses: [{ status: 200, description: 'List of safe payment gateway descriptors' }],
    },
  },
}

export default GET
