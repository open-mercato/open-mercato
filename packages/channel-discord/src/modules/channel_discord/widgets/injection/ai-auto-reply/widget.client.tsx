'use client'

import * as React from 'react'
import Link from 'next/link'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { Button } from '@open-mercato/ui/primitives/button'
import { Tag } from '@open-mercato/ui/primitives/tag'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'

type ChannelRow = {
  id: string
  providerKey: string
  displayName: string
  externalIdentifier: string | null
}

type ChannelsResponse = {
  items?: ChannelRow[]
}

type ChannelAiSettings = {
  aiAutoReplyEnabled: boolean
  aiAgentId: string | null
}

type ChannelEntry = ChannelRow & { ai: ChannelAiSettings | null }

/**
 * Entry point to the per-channel AI auto-reply settings, rendered on the Discord
 * integration's detail page (issue #4778).
 *
 * It lives here rather than as a row action on the hub's channel table because
 * injected row actions render on EVERY row of that table — a "Discord AI
 * auto-reply" entry would then appear on Gmail and IMAP channels too. The
 * integration detail spot is Discord-scoped by construction, which is exactly the
 * scoping this affordance needs.
 */
export default function DiscordAiAutoReplyWidget(
  _props: InjectionWidgetComponentProps<Record<string, unknown>, Record<string, unknown>>,
) {
  const t = useT()
  const [entries, setEntries] = React.useState<ChannelEntry[] | null>(null)
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      const listed = await apiCall<ChannelsResponse>(
        '/api/communication_channels/channels?providerKey=discord&pageSize=100',
      ).catch(() => null)
      if (cancelled) return
      if (!listed?.ok) {
        setErrorMessage(
          t('channel_discord.aiAutoReply.errors.loadChannels', 'Failed to load Discord channels'),
        )
        setEntries([])
        return
      }
      const channels = listed.result?.items ?? []
      const withSettings = await Promise.all(
        channels.map(async (channel) => {
          const settings = await apiCall<ChannelAiSettings>(
            `/api/channel_discord/channels/${encodeURIComponent(channel.id)}/ai-auto-reply`,
          ).catch(() => null)
          return { ...channel, ai: settings?.ok ? (settings.result ?? null) : null }
        }),
      )
      if (cancelled) return
      setEntries(withSettings)
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [t])

  if (errorMessage) return <ErrorMessage label={errorMessage} />
  if (entries === null) {
    return <LoadingMessage label={t('channel_discord.aiAutoReply.loadingChannels', 'Loading Discord channels...')} />
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {t(
          'channel_discord.aiAutoReply.widget.description',
          'Let an AI agent answer inbound Discord messages. Every channel is off by default, and anything sensitive or low-confidence is proposed for a human to approve instead of being sent.',
        )}
      </p>
      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t(
            'channel_discord.aiAutoReply.widget.noChannels',
            'Connect a Discord bot first — auto-reply is configured per channel.',
          )}
        </p>
      ) : (
        <ul className="divide-y rounded-md border">
          {entries.map((entry) => (
            <li key={entry.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{entry.displayName}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {entry.ai?.aiAgentId
                    ?? t('channel_discord.aiAutoReply.widget.noAgent', 'No agent selected')}
                </div>
              </div>
              <div className="flex items-center gap-3">
                {entry.ai?.aiAutoReplyEnabled ? (
                  <Tag variant="success" dot>
                    {t('channel_discord.aiAutoReply.widget.on', 'Auto-reply on')}
                  </Tag>
                ) : (
                  <Tag variant="neutral">{t('channel_discord.aiAutoReply.widget.off', 'Auto-reply off')}</Tag>
                )}
                <Button asChild type="button" variant="outline">
                  <Link href={`/backend/channel_discord/channels/${encodeURIComponent(entry.id)}/ai-auto-reply`}>
                    {t('channel_discord.aiAutoReply.widget.configure', 'Configure')}
                  </Link>
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
