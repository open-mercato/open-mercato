'use client'

import * as React from 'react'
import { useParams } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { LoadingMessage, ErrorMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { Tag } from '@open-mercato/ui/primitives/tag'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type ChannelDetail = {
  id: string
  providerKey: string
  channelType: string
  displayName: string
  externalIdentifier: string | null
  capabilities: Record<string, unknown> | null
  isActive: boolean
}

type ChannelHealth = {
  channelId: string
  providerKey: string
  channelType: string
  windowHours: number
  totalsLast24h: number
  counts: Record<string, number>
  recentFailures: Array<{
    id: string
    messageId: string
    direction: string
    createdAt: string | null
    lastError: string | null
    transient: boolean | null
  }>
}

export default function ChannelDetailPage() {
  const t = useT()
  const params = useParams<{ id: string }>()
  const id = (params?.id as string) ?? ''

  const [detail, setDetail] = React.useState<ChannelDetail | null>(null)
  const [health, setHealth] = React.useState<ChannelHealth | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null)
  const [notFound, setNotFound] = React.useState(false)

  React.useEffect(() => {
    if (!id) return
    let cancelled = false
    async function load() {
      setIsLoading(true)
      setErrorMessage(null)
      setNotFound(false)
      const [detailRes, healthRes] = await Promise.all([
        apiCall<ChannelDetail>(`/api/communication_channels/channels/${encodeURIComponent(id)}`),
        apiCall<ChannelHealth>(`/api/communication_channels/channels/${encodeURIComponent(id)}/health`),
      ]).catch((err: unknown) => {
        return [
          { ok: false, result: { error: err instanceof Error ? err.message : 'load failed' } },
          { ok: false, result: { error: err instanceof Error ? err.message : 'load failed' } },
        ] as const
      })
      if (cancelled) return
      if (!detailRes.ok) {
        const status = (detailRes as { status?: number }).status
        if (status === 404) {
          setNotFound(true)
        } else {
          const body = detailRes.result as { error?: string } | undefined
          setErrorMessage(
            body?.error ?? t('communication_channels.errors.loadDetail', 'Failed to load channel'),
          )
        }
        setDetail(null)
        setHealth(null)
      } else {
        setDetail(detailRes.result ?? null)
        setHealth(healthRes.ok ? (healthRes.result ?? null) : null)
      }
      setIsLoading(false)
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [id, t])

  if (isLoading) {
    return (
      <Page>
        <PageBody>
          <LoadingMessage label={t('communication_channels.detail.loading', 'Loading channel...')} />
        </PageBody>
      </Page>
    )
  }
  if (notFound) {
    return (
      <Page>
        <PageBody>
          <RecordNotFoundState
            label={t('communication_channels.detail.notFound', 'Channel not found')}
            backHref="/backend/communication_channels/channels"
          />
        </PageBody>
      </Page>
    )
  }
  if (errorMessage || !detail) {
    return (
      <Page>
        <PageBody>
          <ErrorMessage
            label={errorMessage ?? t('communication_channels.errors.loadDetail', 'Failed to load channel')}
          />
        </PageBody>
      </Page>
    )
  }

  const capabilities = (detail.capabilities ?? {}) as Record<string, unknown>
  const capabilityKeys = Object.keys(capabilities)

  return (
    <Page>
      <PageBody>
        <header className="mb-4 flex flex-wrap items-baseline justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold">{detail.displayName}</h2>
            <p className="text-sm text-muted-foreground">
              {detail.providerKey} · {detail.channelType}
              {detail.externalIdentifier ? ` · ${detail.externalIdentifier}` : ''}
            </p>
          </div>
          {detail.isActive ? (
            <Tag variant="success" dot>
              {t('communication_channels.status.active', 'Active')}
            </Tag>
          ) : (
            <Tag variant="neutral">{t('communication_channels.status.inactive', 'Inactive')}</Tag>
          )}
        </header>

        <section
          className="mb-4 rounded-md border bg-card p-4"
          aria-label={t('communication_channels.detail.capabilities', 'Capabilities')}
        >
          <header className="mb-2 text-overline text-muted-foreground">
            {t('communication_channels.detail.capabilities', 'Capabilities')}
          </header>
          {capabilityKeys.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t(
                'communication_channels.detail.noCapabilities',
                'No capabilities snapshot recorded for this channel yet.',
              )}
            </p>
          ) : (
            <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm md:grid-cols-3">
              {capabilityKeys.sort().map((key) => (
                <React.Fragment key={key}>
                  <dt className="text-muted-foreground">{key}</dt>
                  <dd className="md:col-span-2">{renderCapabilityValue(capabilities[key])}</dd>
                </React.Fragment>
              ))}
            </dl>
          )}
        </section>

        <section
          className="rounded-md border bg-card p-4"
          aria-label={t('communication_channels.detail.health', 'Delivery health (last 24h)')}
        >
          <header className="mb-2 flex items-baseline justify-between text-overline text-muted-foreground">
            <span>{t('communication_channels.detail.health', 'Delivery health (last 24h)')}</span>
            {health ? (
              <span className="text-xs">
                {health.totalsLast24h}{' '}
                {t('communication_channels.detail.messages', 'messages')}
              </span>
            ) : null}
          </header>
          {health ? (
            <>
              <ul className="mb-3 flex flex-wrap gap-2 text-xs">
                {Object.entries(health.counts).map(([status, count]) => (
                  <li key={status}>
                    <Tag variant={tagVariantForStatus(status)}>
                      {status}: {count}
                    </Tag>
                  </li>
                ))}
              </ul>
              {health.recentFailures.length > 0 ? (
                <details>
                  <summary className="cursor-pointer text-sm text-muted-foreground">
                    {t('communication_channels.detail.recentFailures', 'Recent failures')} (
                    {health.recentFailures.length})
                  </summary>
                  <ul className="mt-2 space-y-1 text-xs">
                    {health.recentFailures.map((failure) => (
                      <li key={failure.id} className="rounded border bg-muted p-2">
                        <div className="font-mono text-xs text-muted-foreground">
                          {failure.messageId} · {failure.direction} ·{' '}
                          {failure.createdAt ?? '—'}
                        </div>
                        {failure.lastError ? (
                          <div className="mt-1">{failure.lastError}</div>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              {t('communication_channels.detail.noHealth', 'No health data available.')}
            </p>
          )}
        </section>
      </PageBody>
    </Page>
  )
}

function renderCapabilityValue(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (Array.isArray(value)) return value.join(', ')
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function tagVariantForStatus(status: string): 'success' | 'warning' | 'error' | 'info' | 'neutral' {
  switch (status) {
    case 'sent':
    case 'delivered':
    case 'read':
      return 'success'
    case 'failed':
      return 'error'
    case 'pending':
    case 'queued':
      return 'warning'
    default:
      return 'neutral'
  }
}
