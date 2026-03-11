import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { GatewayPaymentLink } from '../../../../data/entities'
import { paymentLinkUnlockSchema } from '../../../../data/validators'
import {
  createPaymentLinkAccessToken,
  verifyPaymentLinkPassword,
} from '../../../../lib/payment-links'
import { paymentGatewaysTag } from '../../../openapi'

export const metadata = {
  path: '/payment_gateways/pay/[token]/unlock',
  POST: { requireAuth: false },
}

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> | { token: string } }) {
  const { token } = await params
  if (!token) {
    return NextResponse.json({ error: 'Payment link token is required' }, { status: 400 })
  }

  const payload = await readJsonSafe<unknown>(req)
  const parsed = paymentLinkUnlockSchema.safeParse(payload)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload', details: parsed.error.flatten() }, { status: 422 })
  }

  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager
  const link = await findOneWithDecryption(em, GatewayPaymentLink, { token, deletedAt: null })
  if (!link) {
    return NextResponse.json({ error: 'Payment link not found' }, { status: 404 })
  }
  if (!link.passwordHash) {
    return NextResponse.json({ accessToken: null, passwordRequired: false })
  }

  const isValid = await verifyPaymentLinkPassword(parsed.data.password, link.passwordHash)
  if (!isValid) {
    return NextResponse.json({ error: 'Invalid password' }, { status: 403 })
  }

  return NextResponse.json({
    accessToken: createPaymentLinkAccessToken(link),
    passwordRequired: false,
  })
}

export const openApi = {
  tags: [paymentGatewaysTag],
  summary: 'Unlock a password-protected payment link',
  methods: {
    POST: {
      summary: 'Unlock payment link',
      tags: [paymentGatewaysTag],
      responses: [
        { status: 200, description: 'Payment link unlocked' },
        { status: 403, description: 'Invalid password' },
      ],
    },
  },
}

export default POST
