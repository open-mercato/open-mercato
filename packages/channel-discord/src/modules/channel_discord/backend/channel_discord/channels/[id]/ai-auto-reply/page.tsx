'use client'

import * as React from 'react'
import { useParams } from 'next/navigation'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { ErrorMessage, LoadingMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'

type EligibleAgent = {
  id: string
  label: string
  description: string
  requiredFeatures: string[]
  /** Whether the auto-reply principal holds the agent's `requiredFeatures`. */
  invocable: boolean
  missingFeatures: string[]
}

type AiAutoReplySettings = {
  channelId: string
  displayName: string
  updatedAt: string | null
  aiAutoReplyEnabled: boolean
  aiAgentId: string | null
  aiAutoReplyLastError: string | null
  aiAutoReplyLastErrorAt: string | null
  defaultAgentId: string
  aiAvailable: boolean
  agents: EligibleAgent[]
}

type FormValues = {
  id: string
  updatedAt: string | null
  aiAutoReplyEnabled: boolean
  aiAgentId: string
}

const CHANNELS_LIST_HREF = '/backend/communication_channels/channels'

/**
 * Per-channel AI auto-reply settings (issue #4778) — the surface that writes
 * `aiAutoReplyEnabled` / `aiAgentId`, the two keys the subscriber reads.
 *
 * It is a `CrudForm` rather than a hand-rolled form so the save inherits the
 * platform's contract for free: zod validation with field-level errors, and the
 * optimistic-lock header auto-derived from `initialValues.updatedAt`, so a save
 * from a tab opened before someone else touched the channel surfaces the shared
 * conflict bar instead of overwriting them.
 */
export default function DiscordAiAutoReplyPage() {
  const t = useT()
  const params = useParams<{ id: string }>()
  const channelId = (params?.id as string) ?? ''

  const [settings, setSettings] = React.useState<AiAutoReplySettings | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null)
  const [notFound, setNotFound] = React.useState(false)

  const load = React.useCallback(async () => {
    if (!channelId) return
    setIsLoading(true)
    setErrorMessage(null)
    setNotFound(false)
    const response = await apiCall<AiAutoReplySettings>(
      `/api/channel_discord/channels/${encodeURIComponent(channelId)}/ai-auto-reply`,
    ).catch(() => null)
    if (!response || !response.ok) {
      const status = (response as { status?: number } | null)?.status
      if (status === 404) {
        setNotFound(true)
      } else {
        const body = response?.result as { error?: string } | undefined
        setErrorMessage(
          body?.error ?? t('channel_discord.aiAutoReply.errors.load', 'Failed to load AI auto-reply settings'),
        )
      }
      setSettings(null)
    } else {
      setSettings(response.result ?? null)
    }
    setIsLoading(false)
  }, [channelId, t])

  React.useEffect(() => {
    void load()
  }, [load])

  const fields = React.useMemo<CrudField[]>(() => {
    // An agent the auto-reply principal cannot invoke stays in the list — hiding
    // it would leave the operator wondering where an agent they can see elsewhere
    // went — but it says what it needs, so the requirement is visible before the
    // save rather than only in the 400 that follows.
    const agentOptions = (settings?.agents ?? []).map((agent) => ({
      value: agent.id,
      label: agent.invocable
        ? agent.label
        : t(
          'channel_discord.aiAutoReply.fields.agentMissingFeatures',
          '{label} — needs {features}',
          { label: agent.label, features: agent.missingFeatures.join(', ') },
        ),
    }))
    return [
      {
        id: 'aiAutoReplyEnabled',
        type: 'checkbox',
        label: t('channel_discord.aiAutoReply.fields.enabled', 'Answer inbound Discord messages with AI'),
        description: t(
          'channel_discord.aiAutoReply.fields.enabledHelp',
          'Off by default. When on, straightforward messages are answered automatically; anything sensitive, low-confidence or suspicious is proposed for a human to approve instead.',
        ),
        disabled: !settings?.aiAvailable,
      },
      {
        id: 'aiAgentId',
        type: 'select',
        label: t('channel_discord.aiAutoReply.fields.agent', 'Agent'),
        description: t(
          'channel_discord.aiAutoReply.fields.agentHelp',
          'Only agents that produce structured output can answer a channel. Grant the tenant channel-bot user the agent’s required features before choosing an agent from another module.',
        ),
        options: agentOptions,
        required: true,
        visibleWhen: { field: 'aiAutoReplyEnabled', equals: true },
      },
    ]
  }, [settings, t])

  const initialValues = React.useMemo<Partial<FormValues>>(() => {
    if (!settings) return {}
    // Default to an agent the principal can actually invoke, so the form does not
    // pre-select a choice the save will reject.
    const invocable = settings.agents.filter((agent) => agent.invocable)
    const fallbackAgentId = invocable.some((agent) => agent.id === settings.defaultAgentId)
      ? settings.defaultAgentId
      : (invocable[0]?.id ?? settings.agents[0]?.id ?? '')
    return {
      id: settings.channelId,
      updatedAt: settings.updatedAt,
      aiAutoReplyEnabled: settings.aiAutoReplyEnabled,
      aiAgentId: settings.aiAgentId ?? fallbackAgentId,
    }
  }, [settings])

  const onSubmit = React.useCallback(
    async (values: FormValues) => {
      const enabled = Boolean(values.aiAutoReplyEnabled)
      const agentId = (values.aiAgentId ?? '').trim()
      if (enabled && !agentId) {
        throw createCrudFormError(
          t('channel_discord.aiAutoReply.errors.agentRequired', 'Choose the agent that should answer this channel'),
          { aiAgentId: t('channel_discord.aiAutoReply.errors.agentRequired', 'Choose the agent that should answer this channel') },
        )
      }
      // The route enforces this too — it has to, since a role can change between
      // the load and the save. Checking here as well turns the common case into an
      // inline field error instead of a round trip.
      const chosen = settings?.agents.find((agent) => agent.id === agentId)
      if (enabled && chosen && !chosen.invocable) {
        const message = t(
          'channel_discord.aiAutoReply.errors.agentFeaturesMissing',
          'The channel-bot user is missing the features this agent needs: {features}. Grant them first, or pick another agent.',
          { features: chosen.missingFeatures.join(', ') },
        )
        throw createCrudFormError(message, { aiAgentId: message })
      }
      // Deliberately unguarded: a 409 from the optimistic-lock check has to reach
      // CrudForm, which renders it on the shared conflict bar. Catching it here
      // would surface the same bar and then let the form believe the save
      // succeeded.
      await updateCrud(
        `channel_discord/channels/${encodeURIComponent(channelId)}/ai-auto-reply`,
        {
          aiAutoReplyEnabled: enabled,
          aiAgentId: enabled ? agentId : undefined,
        },
        {
          errorMessage: t(
            'channel_discord.aiAutoReply.errors.save',
            'Failed to save AI auto-reply settings',
          ),
        },
      )
      flash(t('channel_discord.aiAutoReply.saved', 'AI auto-reply settings saved.'), 'success')
      await load()
    },
    [channelId, load, settings, t],
  )

  if (isLoading) {
    return (
      <Page>
        <PageBody>
          <LoadingMessage label={t('channel_discord.aiAutoReply.loading', 'Loading AI auto-reply settings...')} />
        </PageBody>
      </Page>
    )
  }

  if (notFound) {
    return (
      <Page>
        <PageBody>
          <RecordNotFoundState
            label={t('channel_discord.aiAutoReply.notFound', 'Discord channel not found')}
            backHref={CHANNELS_LIST_HREF}
          />
        </PageBody>
      </Page>
    )
  }

  if (errorMessage || !settings) {
    return (
      <Page>
        <PageBody>
          <ErrorMessage
            label={
              errorMessage
              ?? t('channel_discord.aiAutoReply.errors.load', 'Failed to load AI auto-reply settings')
            }
          />
        </PageBody>
      </Page>
    )
  }

  return (
    <Page>
      <PageBody>
        <CrudForm<FormValues>
          title={t('channel_discord.aiAutoReply.page.title', 'Discord AI auto-reply')}
          titleHeadingLevel={1}
          backHref={CHANNELS_LIST_HREF}
          cancelHref={CHANNELS_LIST_HREF}
          fields={fields}
          initialValues={initialValues}
          onSubmit={onSubmit}
          submitLabel={t('channel_discord.aiAutoReply.save', 'Save')}
          contentHeader={
            <div className="mb-4 space-y-2 text-sm text-muted-foreground">
              <p>
                {t(
                  'channel_discord.aiAutoReply.intro',
                  'Choose whether this Discord channel may answer on its own, and which agent drafts the reply.',
                )}{' '}
                <span className="font-medium text-foreground">{settings.displayName}</span>
              </p>
              {settings.aiAvailable ? null : (
                <p>
                  {t(
                    'channel_discord.aiAutoReply.unavailable',
                    'The AI assistant module is not installed in this deployment, so auto-reply cannot be enabled. The channel keeps working as a normal inbox.',
                  )}
                </p>
              )}
              {settings.aiAutoReplyLastError ? (
                // An armed channel whose runtime call keeps being refused is the
                // dormancy failure wearing a green tag. It is reported here, on the
                // surface that armed it, rather than only in a subscriber log line.
                <p className="rounded-md border border-status-error-border bg-status-error-bg p-3 text-status-error-text">
                  {t(
                    'channel_discord.aiAutoReply.lastError',
                    'The last auto-reply attempt on this channel produced nothing: {reason}',
                    { reason: settings.aiAutoReplyLastError },
                  )}
                  {settings.aiAutoReplyLastErrorAt ? (
                    <span className="ml-1">
                      {t('channel_discord.aiAutoReply.lastErrorAt', '(first seen {at})', {
                        at: new Date(settings.aiAutoReplyLastErrorAt).toLocaleString(),
                      })}
                    </span>
                  ) : null}
                </p>
              ) : null}
            </div>
          }
        />
      </PageBody>
    </Page>
  )
}
