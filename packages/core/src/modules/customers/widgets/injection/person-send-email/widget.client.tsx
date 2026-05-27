'use client'

import * as React from 'react'
import Link from 'next/link'
import { Mail } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  ComposeEmailDialog,
  type ComposeEmailChannel,
  type ComposeEmailValues,
} from '../../../components/detail/ComposeEmailDialog'

type PersonSendEmailContext = {
  personId?: string | null
  data?: {
    person?: {
      id?: string
      primaryEmail?: string | null
    }
  } | null
}

type PersonSendEmailProps = {
  context?: PersonSendEmailContext
  data?: PersonSendEmailContext['data']
}

export function PersonSendEmailWidget({ context, data: dataProp }: PersonSendEmailProps) {
  const t = useT()

  const resolvedData = dataProp ?? context?.data ?? null
  const personId =
    (typeof context?.personId === 'string' && context.personId ? context.personId : null) ??
    resolvedData?.person?.id ??
    null
  const personEmail = resolvedData?.person?.primaryEmail ?? null

  const [channels, setChannels] = React.useState<ComposeEmailChannel[] | null>(null)
  const [open, setOpen] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    apiCall<{ items?: unknown[] }>(
      '/api/communication_channels/me/channels',
      { method: 'GET' },
    )
      .then((r) => {
        if (cancelled) return
        const allItems: unknown[] = Array.isArray(r.result?.items) ? r.result!.items! : []
        const connected = allItems.filter(
          (item) =>
            item !== null &&
            typeof item === 'object' &&
            (item as Record<string, unknown>).status === 'connected',
        ) as ComposeEmailChannel[]
        setChannels(connected)
      })
      .catch(() => {
        if (!cancelled) setChannels([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (!personId) return null
  if (channels === null) return null // loading — render nothing

  if (channels.length === 0) {
    return (
      <Button asChild variant="outline" size="sm" className="gap-2">
        <Link href="/backend/profile/communication-channels">
          <Mail className="h-4 w-4" />
          {t('customers.email.compose.noChannel.cta', 'Connect your mailbox')}
        </Link>
      </Button>
    )
  }

  const onSend = async (values: ComposeEmailValues) => {
    const response = await apiCall<{ messageId?: string }>(
      `/api/customers/people/${encodeURIComponent(personId)}/emails`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(values),
      },
    )
    if (!response.ok) {
      const err = response.result as { error?: string } | null
      throw new Error(err?.error ?? t('customers.email.errors.sendFailed', 'Send failed'))
    }
    flash(t('customers.email.compose.sent', 'Email sent'), 'success')
    return { messageId: response.result?.messageId ?? null }
  }

  return (
    <>
      <Button variant="default" size="sm" className="gap-2" onClick={() => setOpen(true)}>
        <Mail className="h-4 w-4" />
        {t('customers.email.compose.button', 'Send email')}
      </Button>
      <ComposeEmailDialog
        open={open}
        onOpenChange={setOpen}
        personId={personId}
        defaultRecipient={personEmail}
        channels={channels}
        onSend={onSend}
      />
    </>
  )
}

export default PersonSendEmailWidget
