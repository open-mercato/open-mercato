import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { resolveApiHost } from '../../lib/autopay-client'
import { reportAutopayError } from '../../lib/error-reporting'
import {
  isWellFormedLaunchToken,
  isWellFormedOrderId,
  LAUNCH_PAGE_CONTENT_SECURITY_POLICY,
  launchGrantMatches,
  readFormPost,
  renderLaunchPage,
} from '../../lib/launch'
import {
  findAutopayCandidates,
  htmlResponse,
  limitPublicRequest,
  messageResponse,
  readTransactionMetadata,
} from '../../lib/public-route'

export const metadata = {
  path: '/gateway_autopay/launch',
  GET: { requireAuth: false },
}

export async function GET(req: Request) {
  const { t } = await resolveTranslations()
  const unavailable = (status: number) => messageResponse(
    {
      title: t('gateway_autopay.launch.unavailableTitle', 'Payment link unavailable'),
      message: t(
        'gateway_autopay.launch.unavailable',
        'This payment link is invalid, has expired, or the payment is no longer pending. Go back to the shop and start the payment again.',
      ),
    },
    status,
  )

  const container = await createRequestContainer()
  const limited = await limitPublicRequest(container, req, 'launch')
  if (limited) return limited

  const params = new URL(req.url).searchParams
  const orderId = params.get('o') ?? ''
  const token = params.get('t') ?? ''
  if (!isWellFormedOrderId(orderId) || !isWellFormedLaunchToken(token)) return unavailable(404)

  try {
    const em = container.resolve('em') as EntityManager
    const candidates = await findAutopayCandidates(em, orderId)
    const matches = candidates.filter((candidate) => (
      launchGrantMatches(readTransactionMetadata(candidate).launch, token)
    ))
    if (matches.length !== 1) return unavailable(404)

    const [transaction] = matches
    if (transaction.unifiedStatus !== 'pending') return unavailable(404)

    const form = readFormPost(readTransactionMetadata(transaction).formPost)
    if (!form) return unavailable(404)
    resolveApiHost(form.url)

    return htmlResponse(
      renderLaunchPage(form, {
        title: t('gateway_autopay.launch.title', 'Redirecting to Autopay'),
        message: t(
          'gateway_autopay.launch.redirecting',
          'Redirecting you to Autopay to complete the payment. If nothing happens, use the button below.',
        ),
        continueLabel: t('gateway_autopay.launch.continue', 'Continue to Autopay'),
      }),
      200,
      LAUNCH_PAGE_CONTENT_SECURITY_POLICY,
    )
  } catch (error) {
    reportAutopayError(error, 'gateway_autopay.launch_failed')
    return unavailable(500)
  }
}

export const openApi = {
  tags: ['Autopay'],
  summary: 'Start an Autopay payment',
  methods: {
    GET: {
      summary: 'Render the page that forwards the payer to Autopay with a signed POST',
      tags: ['Autopay'],
      responses: [
        { status: 200, description: 'HTML page that submits the signed payment form to Autopay' },
        { status: 404, description: 'The link is invalid, expired or the payment is no longer pending' },
        { status: 429, description: 'Too many requests' },
        { status: 500, description: 'The payment could not be started' },
      ],
    },
  },
}

export default GET
