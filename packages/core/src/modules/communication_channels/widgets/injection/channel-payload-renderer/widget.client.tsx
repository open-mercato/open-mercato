'use client'

import * as React from 'react'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type ChannelPayloadEnrichment = {
  channelContentType: string | null
  channelPayload: Record<string, unknown> | null
  interactiveState: Record<string, unknown> | null
  channelMetadata: Record<string, unknown> | null
  // Email HTML is sanitized server-side by the channel-payload enricher and
  // delivered here ready to render — the client never imports `sanitize-html`.
  sanitizedHtml: string | null
}

type MessageWithPayload = Record<string, unknown> & {
  id?: string
  _channelPayload?: ChannelPayloadEnrichment | null
}

export default function ChannelPayloadRendererWidget({
  data,
}: InjectionWidgetComponentProps<Record<string, unknown>, MessageWithPayload>) {
  const t = useT()
  const payload = data?._channelPayload ?? null
  if (!payload || !payload.channelContentType) return null

  const { channelContentType, channelPayload, sanitizedHtml } = payload

  // Email / HTML — render the HTML the server already sanitized.
  if (channelContentType.startsWith('email/') && typeof sanitizedHtml === 'string') {
    return (
      <section
        className="rounded-md border bg-card p-4 text-sm"
        aria-label={t(
          'communication_channels.channelPayload.email.aria',
          'Channel payload — email',
        )}
      >
        <div dangerouslySetInnerHTML={{ __html: sanitizedHtml }} />
      </section>
    )
  }

  // Provider-specific payloads (Slack Block Kit, WhatsApp interactive) —
  // hub-level fallback shows raw JSON; provider packages override this widget.
  return (
    <section
      className="rounded-md border bg-muted p-4 text-xs"
      aria-label={t('communication_channels.channelPayload.aria', 'Channel payload')}
    >
      <header className="mb-2 text-overline text-muted-foreground">
        {t(
          `communication_channels.channelPayload.types.${channelContentType}`,
          channelContentType,
        )}
      </header>
      <pre className="overflow-auto whitespace-pre-wrap break-words">
        {JSON.stringify(channelPayload, null, 2)}
      </pre>
    </section>
  )
}
