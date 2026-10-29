import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { UnifiedPaymentStatus } from '@open-mercato/shared/modules/payment_gateways/types'
import type { CredentialsService } from '@open-mercato/core/modules/integrations/lib/credentials-service'
import type { PaymentGatewayService } from '@open-mercato/core/modules/payment_gateways/lib/gateway-service'
import { reportAutopayError } from '../../lib/error-reporting'
import { isWellFormedOrderId, pickReturnTarget, readReturnTargets } from '../../lib/launch'
import {
  findAutopayCandidates,
  limitPublicRequest,
  messageResponse,
  readTransactionMetadata,
  redirectResponse,
} from '../../lib/public-route'
import { isValidReturnSignature, readReturnQuery } from '../../lib/return-bridge'

const INTEGRATION_ID = 'gateway_autopay'

export const metadata = {
  path: '/gateway_autopay/return',
  GET: { requireAuth: false },
}

export async function GET(req: Request) {
  const { t } = await resolveTranslations()
  const unavailable = (status: number) => messageResponse(
    {
      title: t('gateway_autopay.return.unavailableTitle', 'Payment return not recognized'),
      message: t(
        'gateway_autopay.return.unavailable',
        'We could not match this return to a payment. Go back to the shop to check the payment status.',
      ),
    },
    status,
  )

  const container = await createRequestContainer()
  const limited = await limitPublicRequest(container, req, 'return')
  if (limited) return limited

  const query = readReturnQuery(new URL(req.url).searchParams)
  if (!query || !isWellFormedOrderId(query.orderId)) return unavailable(400)

  try {
    const em = container.resolve('em') as EntityManager
    const credentialsService = container.resolve('integrationCredentialsService') as CredentialsService
    const candidates = await findAutopayCandidates(em, query.orderId)

    const verified = []
    for (const candidate of candidates) {
      const credentials = await credentialsService.resolve(INTEGRATION_ID, {
        organizationId: candidate.organizationId,
        tenantId: candidate.tenantId,
      })
      if (credentials && isValidReturnSignature(credentials, query)) verified.push(candidate)
    }
    if (verified.length !== 1) return unavailable(400)

    const [transaction] = verified
    let status = transaction.unifiedStatus as UnifiedPaymentStatus
    try {
      const service = container.resolve('paymentGatewayService') as PaymentGatewayService
      const canonical = await service.getPaymentStatus(transaction.id, {
        organizationId: transaction.organizationId,
        tenantId: transaction.tenantId,
      })
      status = canonical.status
    } catch (error) {
      reportAutopayError(error, 'gateway_autopay.return_failed')
    }

    const target = pickReturnTarget(status, readReturnTargets(readTransactionMetadata(transaction).returnTargets))
    if (target) return redirectResponse(target)
    return messageResponse(
      {
        title: t('gateway_autopay.return.doneTitle', 'Payment status updated'),
        message: t('gateway_autopay.return.done', 'You can close this window and return to the shop.'),
      },
      200,
    )
  } catch (error) {
    reportAutopayError(error, 'gateway_autopay.return_failed')
    return unavailable(500)
  }
}

export const openApi = {
  tags: ['Autopay'],
  summary: 'Autopay payer return',
  methods: {
    GET: {
      summary: 'Verify the signed return from Autopay, refresh the payment status and send the payer back to the shop',
      tags: ['Autopay'],
      responses: [
        { status: 200, description: 'Status refreshed; no shop return address was stored for this payment' },
        { status: 302, description: 'Redirect to the shop success or cancel page' },
        { status: 400, description: 'The return could not be matched to exactly one payment' },
        { status: 429, description: 'Too many requests' },
        { status: 500, description: 'The return could not be processed' },
      ],
    },
  },
}

export default GET
