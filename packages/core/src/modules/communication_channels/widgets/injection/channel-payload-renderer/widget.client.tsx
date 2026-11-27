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

<<<<<<< HEAD
=======
function EmailPayload({ html }: { html: string }) {
  const t = useT()
  const bodyRef = React.useRef<HTMLDivElement>(null)
  const [remoteImagesAllowed, setRemoteImagesAllowed] = React.useState(false)
  const hasRemoteImages = html.includes('data-channel-remote-src=')

  React.useEffect(() => {
    if (!remoteImagesAllowed) return
    for (const image of bodyRef.current?.querySelectorAll<HTMLImageElement>('img[data-channel-remote-src]') ?? []) {
      const source = image.getAttribute('data-channel-remote-src')
      if (source && /^https?:\/\//i.test(source)) {
        image.referrerPolicy = 'no-referrer'
        image.src = source.replace(/[<>"']/g, (character) => `%${character.charCodeAt(0).toString(16)}`)
      }
    }
  }, [remoteImagesAllowed])

  return (
    <section
      className="rounded-md border border-border bg-card p-4 text-sm"
      aria-label={t('communication_channels.channelPayload.email.aria')}
    >
      {hasRemoteImages && !remoteImagesAllowed ? (
        <Alert
          status="information"
          style="lighter"
          className="mb-4"
          action={(
            <Button type="button" variant="outline" size="sm" onClick={() => setRemoteImagesAllowed(true)}>
              {t('communication_channels.channelPayload.email.loadRemoteImages')}
            </Button>
          )}
        >
          {t('communication_channels.channelPayload.email.remoteImagesBlocked')}
        </Alert>
      ) : null}
      <div
        ref={bodyRef}
        className="contain-paint overflow-x-auto"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </section>
  )
}

>>>>>>> 6c98970ac0 (fix(communication_channels): confine inbound email content to its body (#10614) (#10853))
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
