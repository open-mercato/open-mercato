"use client"

import * as React from 'react'
import Link from 'next/link'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { Button } from '@open-mercato/ui/primitives/button'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'

type TokenMessageObject = {
  id: string
  entityModule: string
  entityType: string
  entityId: string
  actionRequired: boolean
  actionType?: string | null
  actionLabel?: string | null
}

type MessageTokenResponse = {
  id: string
  subject: string
  body: string
  bodyFormat: 'text' | 'markdown'
  senderUserId: string
  sentAt?: string | null
  objects: TokenMessageObject[]
  requiresAuth: boolean
  recipientUserId: string
}

function toErrorMessage(payload: unknown): string | null {
  if (!payload) return null
  if (typeof payload === 'string') return payload
  if (Array.isArray(payload)) {
    for (const entry of payload) {
      const nested = toErrorMessage(entry)
      if (nested) return nested
    }
    return null
  }
  if (typeof payload === 'object') {
    const record = payload as Record<string, unknown>
    return (
      toErrorMessage(record.error)
      ?? toErrorMessage(record.message)
      ?? toErrorMessage(record.detail)
      ?? toErrorMessage(record.details)
      ?? null
    )
  }
  return null
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString()
}

export default function MessageTokenPage({ params }: { params: { token: string } }) {
  const t = useT()
  const token = params?.token

  const [loading, setLoading] = React.useState(true)
  const [data, setData] = React.useState<MessageTokenResponse | null>(null)
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null)
  const [errorStatus, setErrorStatus] = React.useState<number | null>(null)

  React.useEffect(() => {
    let mounted = true

    async function run() {
      if (!token) return

      setLoading(true)
      setData(null)
      setErrorMessage(null)
      setErrorStatus(null)

      try {
        const call = await apiCall<MessageTokenResponse>(`/api/messages/token/${encodeURIComponent(token)}`)

        if (!mounted) return

        if (!call.ok || !call.result) {
          const status = call.status
          setErrorStatus(status)

          const fallback = status === 404
            ? t('messages.token.errors.notFound', 'This message link is invalid or has already been used.')
            : status === 409
              ? t('messages.token.errors.limitExceeded', 'This message link reached its usage limit.')
              : status === 410
                ? t('messages.token.errors.expired', 'This message link has expired.')
                : t('messages.token.errors.generic', 'Unable to load this message.')

          setErrorMessage(toErrorMessage(call.result) ?? fallback)
          return
        }

        setData(call.result)
      } catch (err) {
        if (!mounted) return
        setErrorMessage(
          err instanceof Error
            ? err.message
            : t('messages.token.errors.generic', 'Unable to load this message.'),
        )
      } finally {
        if (mounted) {
          setLoading(false)
        }
      }
    }

    void run()

    return () => {
      mounted = false
    }
  }, [t, token])

  if (loading) {
    return (
      <main className="mx-auto max-w-3xl p-6">
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner className="h-4 w-4 animate-spin" />
          {t('messages.token.loading', 'Loading message...')}
        </p>
      </main>
    )
  }

  if (errorMessage || !data) {
    return (
      <main className="mx-auto max-w-3xl space-y-3 p-6">
        <h1 className="text-2xl font-semibold">{t('messages.token.pageTitle', 'Message')}</h1>
        <p className="text-sm text-destructive">{errorMessage ?? t('messages.token.errors.generic', 'Unable to load this message.')}</p>
        {errorStatus ? <p className="text-xs text-muted-foreground">HTTP {errorStatus}</p> : null}
      </main>
    )
  }

  if (data.requiresAuth) {
    return (
      <main className="mx-auto max-w-3xl space-y-4 p-6">
        <h1 className="text-2xl font-semibold">{t('messages.token.authRequired.title', 'Sign in required')}</h1>
        <p className="text-sm text-muted-foreground">
          {t('messages.token.authRequired.description', 'This message includes protected objects. Sign in to continue.')}
        </p>
        <Button asChild>
          <Link href="/login">{t('auth.signIn', 'Sign in')}</Link>
        </Button>
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{data.subject}</h1>
        <p className="text-sm text-muted-foreground">
          {t('messages.token.sentAt', 'Sent')}: {formatDateTime(data.sentAt)}
        </p>
      </header>

      <section className="rounded-xl border bg-card p-4 whitespace-pre-wrap text-sm">
        {data.body}
      </section>

      <section className="space-y-2 rounded-xl border bg-card p-4">
        <h2 className="text-base font-semibold">{t('messages.attachedObjects', 'Attached objects')}</h2>
        {data.objects.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('messages.token.noObjects', 'No objects attached.')}</p>
        ) : (
          <div className="space-y-2">
            {data.objects.map((objectItem) => (
              <div key={objectItem.id} className="rounded border p-3 text-sm">
                <p className="font-medium">{objectItem.entityModule}:{objectItem.entityType}</p>
                <p className="text-xs text-muted-foreground" title={objectItem.entityId}>{objectItem.entityId}</p>
                {objectItem.actionRequired ? (
                  <p className="text-xs text-amber-700">
                    {objectItem.actionLabel || t('messages.composer.objectActionRequired', 'Action required')}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  )
}
