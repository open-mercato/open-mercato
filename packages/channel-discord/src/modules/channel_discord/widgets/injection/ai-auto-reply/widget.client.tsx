'use client'

import * as React from 'react'
import Link from 'next/link'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { Button } from '@open-mercato/ui/primitives/button'
import { Tag } from '@open-mercato/ui/primitives/tag'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'

type ChannelEntry = {
  channelId: string
  displayName: string
  aiAutoReplyEnabled: boolean
  aiAgentId: string | null
  aiAutoReplyLastError: string | null
  aiAutoReplyLastErrorAt: string | null
}

type ChannelsResponse = {
  items?: ChannelEntry[]
  truncated?: boolean
}

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
  const [truncated, setTruncated] = React.useState(false)
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      // One call for the whole panel. Listing the channels and then asking the
      // per-channel settings route for each one was a request per channel, and
      // every one of those responses rebuilt the agent registry to render two
      // booleans.
      const listed = await apiCall<ChannelsResponse>(
        '/api/channel_discord/ai-auto-reply/channels',
      ).catch(() => null)
      if (cancelled) return
      if (!listed?.ok) {
        setErrorMessage(
          t('channel_discord.aiAutoReply.errors.loadChannels', 'Failed to load Discord channels'),
        )
        setEntries([])
        return
      }
      setEntries(listed.result?.items ?? [])
      setTruncated(Boolean(listed.result?.truncated))
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
            <li key={entry.channelId} className="flex flex-wrap items-center justify-between gap-3 p-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{entry.displayName}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {entry.aiAgentId
                    ?? t('channel_discord.aiAutoReply.widget.noAgent', 'No agent selected')}
                </div>
                {entry.aiAutoReplyLastError ? (
                  <div className="truncate text-xs text-status-error-text">
                    {t('channel_discord.aiAutoReply.widget.lastError', 'Last attempt failed: {reason}', {
                      reason: entry.aiAutoReplyLastError,
                    })}
                  </div>
                ) : null}
              </div>
              <div className="flex items-center gap-3">
                {entry.aiAutoReplyEnabled ? (
                  // An armed channel whose last attempt failed is not "on" in any
                  // sense the operator cares about — say so on the tag, not only in
                  // the detail line they may not read.
                  <Tag variant={entry.aiAutoReplyLastError ? 'error' : 'success'} dot>
                    {entry.aiAutoReplyLastError
                      ? t('channel_discord.aiAutoReply.widget.failing', 'Auto-reply failing')
                      : t('channel_discord.aiAutoReply.widget.on', 'Auto-reply on')}
                  </Tag>
                ) : (
                  <Tag variant="neutral">{t('channel_discord.aiAutoReply.widget.off', 'Auto-reply off')}</Tag>
                )}
                <Button asChild type="button" variant="outline">
                  <Link href={`/backend/channel_discord/channels/${encodeURIComponent(entry.channelId)}/ai-auto-reply`}>
                    {t('channel_discord.aiAutoReply.widget.configure', 'Configure')}
                  </Link>
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {truncated ? (
        // A capped list that says nothing reads as "these are all your channels".
        <p className="text-xs text-muted-foreground">
          {t(
            'channel_discord.aiAutoReply.widget.truncated',
            'Only the most recent channels are shown. Open a channel from the Channels page to configure the rest.',
          )}
        </p>
      ) : null}
    </div>
  )
}
