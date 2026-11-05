"use client"
import * as React from 'react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { LoadingMessage, ErrorMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { FormHeader } from '@open-mercato/ui/backend/forms'
import { JsonDisplay } from '@open-mercato/ui/backend/JsonDisplay'
import { StatusBadge, type StatusMap } from '@open-mercato/ui/primitives/status-badge'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type PushDeliveryStatus = 'pending' | 'sending' | 'sent' | 'failed' | 'skipped' | 'expired'

type DeliveryDetail = {
  id: string
  notification_id: string | null
  notification_type_id: string
  user_device_id: string
  user_id: string
  provider: string
  token_snapshot: string
  status: PushDeliveryStatus
  attempts: number
  last_error: string | null
  payload: Record<string, unknown> | null
  provider_response: Record<string, unknown> | null
  created_at: string | null
  sent_at: string | null
  next_retry_at: string | null
  updated_at: string | null
}

const statusVariant: StatusMap<PushDeliveryStatus> = {
  pending: 'info',
  sending: 'info',
  sent: 'success',
  failed: 'error',
  skipped: 'neutral',
  expired: 'warning',
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-sm font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-sm text-foreground">{children}</dd>
    </div>
  )
}

export default function PushDeliveryDetailPage({ params }: { params?: { id?: string } }) {
  const id = typeof params?.id === 'string' ? params.id : ''
  const t = useT()
  const [item, setItem] = React.useState<DeliveryDetail | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [notFound, setNotFound] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setIsLoading(true)
      setError(null)
      setNotFound(false)
      const call = await apiCall<{ item?: DeliveryDetail; error?: string }>(
        `/api/push_notifications/deliveries/${encodeURIComponent(id)}`,
        undefined,
        { fallback: null },
      ).catch(() => null)
      if (cancelled) return
      if (!call || !call.ok) {
        if (call?.status === 404) setNotFound(true)
        else setError((call?.result as { error?: string } | undefined)?.error ?? t('push_notifications.deliveries.error.loadFailed'))
        setIsLoading(false)
        return
      }
      setItem(call.result?.item ?? null)
      setNotFound(!call.result?.item)
      setIsLoading(false)
    }
    if (id) load()
    return () => { cancelled = true }
  }, [id, t])

  return (
    <Page>
      <PageBody>
        {isLoading ? (
          <LoadingMessage label={t('push_notifications.deliveries.detail.loading')} />
        ) : notFound ? (
          <RecordNotFoundState
            label={t('push_notifications.errors.not_found')}
            backHref="/backend/push_notifications"
            backLabel={t('push_notifications.deliveries.title')}
          />
        ) : error ? (
          <ErrorMessage label={error} />
        ) : item ? (
          <div className="flex flex-col gap-6">
            <FormHeader
              mode="detail"
              backHref="/backend/push_notifications"
              backLabel={t('push_notifications.deliveries.title')}
              entityTypeLabel={t('push_notifications.deliveries.detail.pageTitle')}
              title={item.notification_type_id}
              statusBadge={(
                <StatusBadge variant={statusVariant[item.status] ?? 'neutral'} dot>
                  {t(`push_notifications.deliveries.status.${item.status}`)}
                </StatusBadge>
              )}
            />
            <section className="rounded-lg border bg-card p-6">
              <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <DetailRow label={t('push_notifications.deliveries.columns.type')}>{item.notification_type_id}</DetailRow>
                <DetailRow label={t('push_notifications.deliveries.columns.provider')}>{item.provider}</DetailRow>
                <DetailRow label={t('push_notifications.deliveries.columns.attempts')}>{item.attempts}</DetailRow>
                <DetailRow label={t('push_notifications.deliveries.columns.user')}>
                  <code className="font-mono text-xs break-all">{item.user_id}</code>
                </DetailRow>
                <DetailRow label={t('push_notifications.deliveries.detail.device')}>
                  <code className="font-mono text-xs break-all">{item.user_device_id}</code>
                </DetailRow>
                <DetailRow label={t('push_notifications.deliveries.detail.tokenSnapshot')}>
                  <code className="font-mono text-xs">…{item.token_snapshot}</code>
                </DetailRow>
                <DetailRow label={t('push_notifications.deliveries.columns.created')}>
                  {item.created_at ? new Date(item.created_at).toLocaleString() : '—'}
                </DetailRow>
                <DetailRow label={t('push_notifications.deliveries.columns.sent')}>
                  {item.sent_at ? new Date(item.sent_at).toLocaleString() : '—'}
                </DetailRow>
                <DetailRow label={t('push_notifications.deliveries.detail.nextRetry')}>
                  {item.next_retry_at ? new Date(item.next_retry_at).toLocaleString() : '—'}
                </DetailRow>
              </dl>
            </section>
            {item.last_error ? (
              <section className="rounded-lg border border-status-error-border bg-status-error-bg p-6">
                <h2 className="mb-2 text-sm font-medium text-status-error-text">{t('push_notifications.deliveries.detail.lastError')}</h2>
                <pre className="overflow-x-auto whitespace-pre-wrap text-xs text-status-error-text">{item.last_error}</pre>
              </section>
            ) : null}
            <JsonDisplay data={item.payload ?? {}} title={t('push_notifications.deliveries.detail.payload')} />
            <JsonDisplay data={item.provider_response ?? {}} title={t('push_notifications.deliveries.detail.providerResponse')} />
          </div>
        ) : null}
      </PageBody>
    </Page>
  )
}
