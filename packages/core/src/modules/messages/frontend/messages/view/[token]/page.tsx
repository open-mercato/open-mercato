"use client"

import * as React from 'react'
import Link from 'next/link'
import type {
  MessageContentProps,
  MessageObjectAction,
} from '@open-mercato/shared/modules/messages/types'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { MarkdownContent } from '@open-mercato/ui/backend/markdown/MarkdownContent'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { Button } from '@open-mercato/ui/primitives/button'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import {
  resolveMessageActionsComponent,
  resolveMessageContentComponent,
  resolveMessageObjectDetailComponent,
} from '../../../../components/utils/typeUiRegistry'
import { getMessageObjectType } from '../../../../lib/message-objects-registry'
import { getMessageTypeOrDefault } from '../../../../lib/message-types-registry'

type TokenMessageObject = {
  id: string
  entityModule: string
  entityType: string
  entityId: string
  actionRequired: boolean
  actionType?: string | null
  actionLabel?: string | null
  snapshot?: Record<string, unknown> | null
}

type MessageTokenResponse = {
  id: string
  type: string
  subject: string
  body: string
  bodyFormat: 'text' | 'markdown'
  priority: 'low' | 'normal' | 'high' | 'urgent'
  senderUserId: string
  sentAt?: string | null
  actionData?: {
    actions: Array<{
      id: string
      label: string
      labelKey?: string
      variant?: 'default' | 'secondary' | 'destructive' | 'outline' | 'ghost'
      icon?: string
      commandId?: string
      href?: string
      isTerminal?: boolean
      confirmRequired?: boolean
      confirmMessage?: string
    }>
    primaryActionId?: string
    expiresAt?: string
  } | null
  actionTaken?: string | null
  actionTakenAt?: string | null
  actionTakenByUserId?: string | null
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

function toObjectActions(
  objectActions: Array<{
    id: string
    labelKey: string
    variant?: 'default' | 'secondary' | 'destructive' | 'outline'
    icon?: string
    commandId?: string
    href?: string
    isTerminal?: boolean
    confirmRequired?: boolean
    confirmMessage?: string
  }>,
): MessageObjectAction[] {
  return objectActions.map((action) => ({
    id: action.id,
    labelKey: action.labelKey,
    variant: action.variant,
    icon: action.icon,
    commandId: action.commandId,
    href: action.href,
    isTerminal: action.isTerminal,
    confirmRequired: action.confirmRequired,
    confirmMessage: action.confirmMessage,
  }))
}

function mergeTokenActions(
  messageActions: MessageTokenResponse['actionData'],
  defaultActions: Array<{
    id: string
    label: string
    labelKey?: string
    variant?: 'default' | 'secondary' | 'destructive' | 'outline' | 'ghost'
    icon?: string
    commandId?: string
    href?: string
    isTerminal?: boolean
    confirmRequired?: boolean
    confirmMessage?: string
  }> | undefined,
): MessageTokenResponse['actionData'] {
  const deduped = new Map<string, NonNullable<MessageTokenResponse['actionData']>['actions'][number]>()

  for (const action of messageActions?.actions ?? []) {
    const normalizedId = action.id.trim()
    if (!normalizedId) continue
    deduped.set(normalizedId, { ...action, id: normalizedId })
  }

  for (const action of defaultActions ?? []) {
    const normalizedId = action.id.trim()
    if (!normalizedId || deduped.has(normalizedId)) continue
    deduped.set(normalizedId, { ...action, id: normalizedId })
  }

  const actions = Array.from(deduped.values())
  if (actions.length === 0 && !messageActions?.expiresAt) return null

  return {
    actions,
    primaryActionId: messageActions?.primaryActionId,
    expiresAt: messageActions?.expiresAt,
  }
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
      } catch (error) {
        if (!mounted) return
        setErrorMessage(
          error instanceof Error
            ? error.message
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

  const messageType = getMessageTypeOrDefault(data.type)
  const ContentComponent = resolveMessageContentComponent(messageType.ui?.contentComponent)
  const ActionsComponent = resolveMessageActionsComponent(messageType.ui?.actionsComponent)
  const resolvedActionData = mergeTokenActions(data.actionData ?? null, messageType.defaultActions)

  const contentProps: MessageContentProps = {
    message: {
      id: data.id,
      type: data.type,
      subject: data.subject,
      body: data.body,
      bodyFormat: data.bodyFormat,
      priority: data.priority,
      sentAt: data.sentAt ? new Date(data.sentAt) : null,
      senderUserId: data.senderUserId,
      actionData: resolvedActionData,
      actionTaken: data.actionTaken ?? null,
      actionTakenAt: data.actionTakenAt ? new Date(data.actionTakenAt) : null,
    },
    objects: data.objects.map((objectItem) => ({
      id: objectItem.id,
      entityModule: objectItem.entityModule,
      entityType: objectItem.entityType,
      entityId: objectItem.entityId,
      actionRequired: objectItem.actionRequired,
      snapshot: objectItem.snapshot ?? undefined,
    })),
    attachments: [],
  }

  const tokenActions = resolvedActionData?.actions ?? []

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{data.subject}</h1>
        <p className="text-sm text-muted-foreground">
          {t('messages.token.sentAt', 'Sent')}: {formatDateTime(data.sentAt)}
        </p>
      </header>

      <section className="rounded-xl border bg-card p-4">
        {ContentComponent ? (
          <ContentComponent {...contentProps} />
        ) : (
          <MarkdownContent
            body={data.body}
            format={data.bodyFormat}
            className="text-sm whitespace-pre-wrap [&>*]:mb-2 [&>*:last-child]:mb-0 [&_ul]:ml-4 [&_ul]:list-disc [&_ol]:ml-4 [&_ol]:list-decimal [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3 [&_pre]:text-xs"
          />
        )}
      </section>

      {tokenActions.length > 0 ? (
        <section className="space-y-3 rounded-xl border bg-card p-4">
          <h2 className="text-base font-semibold">{t('messages.actions.title', 'Actions')}</h2>
          {ActionsComponent ? (
            <ActionsComponent
              message={{
                id: data.id,
                type: data.type,
                actionData: resolvedActionData,
                actionTaken: data.actionTaken ?? null,
              }}
              onExecuteAction={async (_actionId) => {
                return
              }}
              isExecuting={false}
              executingActionId={null}
            />
          ) : (
            <div className="flex flex-wrap gap-2">
              {tokenActions.map((action) => (
                <Button
                  key={action.id}
                  type="button"
                  variant={action.variant ?? 'default'}
                  disabled
                >
                  {t(action.labelKey ?? action.label, action.label)}
                </Button>
              ))}
            </div>
          )}
        </section>
      ) : null}

      <section className="space-y-2 rounded-xl border bg-card p-4">
        <h2 className="text-base font-semibold">{t('messages.attachedObjects', 'Attached objects')}</h2>
        {data.objects.length === 0 ? (
          null
        ) : (
          <div className="space-y-2">
            {data.objects.map((objectItem) => {
              const objectType = getMessageObjectType(objectItem.entityModule, objectItem.entityType)
              const objectActions = toObjectActions(objectType?.actions ?? [])
              const DetailComponent = resolveMessageObjectDetailComponent(objectItem.entityModule, objectItem.entityType)

              return DetailComponent ? (
                <DetailComponent
                  key={objectItem.id}
                  entityId={objectItem.entityId}
                  entityModule={objectItem.entityModule}
                  entityType={objectItem.entityType}
                  snapshot={objectItem.snapshot ?? undefined}
                  previewData={undefined}
                  actionRequired={objectItem.actionRequired}
                  actionType={objectItem.actionType ?? undefined}
                  actionLabel={objectItem.actionLabel ?? undefined}
                  actions={objectActions}
                  actionTaken={data.actionTaken ?? null}
                  actionTakenAt={data.actionTakenAt ? new Date(data.actionTakenAt) : null}
                  actionTakenByUserId={data.actionTakenByUserId ?? null}
                  onAction={async () => {
                    return
                  }}
                />
              ) : null
            })}
          </div>
        )}
      </section>
    </main>
  )
}
