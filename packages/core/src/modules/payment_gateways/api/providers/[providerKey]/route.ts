import { NextResponse } from 'next/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { paymentGatewaysTag } from '../../openapi'

type PaymentGatewayDescriptorService = {
  get: (providerKey: string) => {
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
  } | null
}

export const metadata = {
  path: '/payment_gateways/providers/[providerKey]',
  GET: { requireAuth: true, requireFeatures: ['payment_gateways.view'] },
}

export async function GET(_request: Request, { params }: { params: Promise<{ providerKey: string }> | { providerKey: string } }) {
  const resolvedParams = await params
  const providerKey = resolvedParams?.providerKey?.trim()
  if (!providerKey) {
    return NextResponse.json({ error: 'Provider key is required' }, { status: 400 })
  }
  const { resolve } = await createRequestContainer()
  const descriptorService = resolve('paymentGatewayDescriptorService') as PaymentGatewayDescriptorService
  const descriptor = descriptorService.get(providerKey)
  if (!descriptor) {
    return NextResponse.json({ error: 'Provider descriptor not found' }, { status: 404 })
  }
  return NextResponse.json(descriptor)
}

export const openApi = {
  tags: [paymentGatewaysTag],
  summary: 'Get payment gateway descriptor',
  methods: {
    GET: {
      summary: 'Get payment gateway descriptor',
      tags: [paymentGatewaysTag],
      responses: [
        { status: 200, description: 'Provider descriptor' },
        { status: 404, description: 'Provider descriptor not found' },
      ],
    },
  },
}

export default GET
