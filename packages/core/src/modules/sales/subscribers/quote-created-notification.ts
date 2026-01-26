import type { NotificationService } from '../../notifications/lib/notificationService'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'

export const metadata = {
  event: 'sales.quote.created',
  id: 'sales:quote-created-notification',
  persistent: true,
}

interface QuoteCreatedPayload {
  quoteId: string
  quoteNumber: string
  tenantId: string
  organizationId?: string | null
  customerId?: string | null
  grandTotalGross?: string | null
  currencyCode?: string | null
}

export default async function handle(
  payload: QuoteCreatedPayload,
  ctx: { resolve: <T = unknown>(name: string) => T }
): Promise<void> {
  const { quoteId, quoteNumber, tenantId, organizationId, grandTotalGross, currencyCode } = payload

  if (!tenantId) {
    return
  }

  let notificationService: NotificationService
  try {
    notificationService = ctx.resolve<NotificationService>('notificationService')
  } catch {
    return
  }

  const { t } = await resolveTranslations()

  const totalDisplay = grandTotalGross && currencyCode
    ? ` (${grandTotalGross} ${currencyCode})`
    : ''

  await notificationService.createForFeature(
    {
      requiredFeature: 'sales.quotes.manage',
      type: 'sales.quote.created',
      title: t('sales.notifications.quote.created.title', 'New Sales Quote'),
      body: t('sales.notifications.quote.created.body', 'Sales quote {quoteNumber} has been created{total}', {
        quoteNumber,
        total: totalDisplay,
      }),
      icon: 'file-text',
      severity: 'info',
      sourceModule: 'sales',
      sourceEntityType: 'sales:quote',
      sourceEntityId: quoteId,
      linkHref: `/backend/sales/quotes/${quoteId}`,
    },
    {
      tenantId,
      organizationId: organizationId ?? null,
    }
  )
}
