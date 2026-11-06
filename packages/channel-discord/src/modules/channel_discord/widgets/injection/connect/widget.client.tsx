'use client'

import * as React from 'react'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { raiseCrudError } from '@open-mercato/ui/backend/utils/serverErrors'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import {
  DISCORD_CONNECT_INITIAL_VALUES,
  buildDiscordConnectRequestBody,
  createDiscordConnectFormSchema,
  type DiscordConnectFormValues,
} from '../../../lib/connect-form'

type WidgetContext = Record<string, unknown> & {
  reload?: () => void
}

const FORM_ID = 'channel-discord-connect-form'
const SNOWFLAKE_PLACEHOLDER = '123456789012345678'

export default function ConnectDiscordWidget({
  context,
}: InjectionWidgetComponentProps<Record<string, unknown>, Record<string, unknown>>) {
  const t = useT()
  const widgetContext = context as WidgetContext | undefined
  const [open, setOpen] = React.useState(false)
  const { runMutation, retryLastMutation } = useGuardedMutation({
    contextId: 'channel-discord-connect',
    blockedMessage: t('channel_discord.connect.blocked', 'Connection blocked by validation'),
  })
  const mutationContext = React.useMemo(
    () => ({ providerKey: 'discord', retryLastMutation }),
    [retryLastMutation],
  )

  const schema = React.useMemo(() => createDiscordConnectFormSchema(t), [t])

  const fields = React.useMemo<CrudField[]>(
    () => [
      {
        id: 'displayName',
        type: 'text',
        label: t('channel_discord.connect.fields.displayName', 'Display name'),
        description: t(
          'channel_discord.connect.fields.displayNameHelp',
          'How the channel is labelled in Open Mercato. Defaults to "Discord".',
        ),
      },
      {
        id: 'botToken',
        type: 'password',
        label: t('channel_discord.connect.fields.botToken', 'Bot token'),
        required: true,
        description: t(
          'channel_discord.connect.fields.botTokenHelp',
          'Developer Portal → Applications → your app → Bot → Reset Token. Grants full control of the bot user. Stored encrypted at rest; never logged.',
        ),
      },
      {
        id: 'applicationId',
        type: 'text',
        label: t('channel_discord.connect.fields.applicationId', 'Application ID'),
        required: true,
        placeholder: SNOWFLAKE_PLACEHOLDER,
        description: t(
          'channel_discord.connect.fields.applicationIdHelp',
          'Developer Portal → General Information → Application ID. Used to register slash commands (mercato channel_discord register-slash-commands) and to answer interactions.',
        ),
      },
      {
        id: 'publicKey',
        type: 'text',
        label: t('channel_discord.connect.fields.publicKey', 'Public key'),
        required: true,
        placeholder: t('channel_discord.connect.fields.publicKeyPlaceholder', '64-character hex Ed25519 public key'),
        description: t(
          'channel_discord.connect.fields.publicKeyHelp',
          'Developer Portal → General Information → Public Key. Verifies signed interaction requests; a verified slash command or button press is recorded in the inbox and answered back in Discord.',
        ),
      },
      {
        id: 'guildId',
        type: 'text',
        label: t('channel_discord.connect.fields.guildId', 'Guild (server) ID'),
        placeholder: SNOWFLAKE_PLACEHOLDER,
        description: t(
          'channel_discord.connect.fields.guildIdHelp',
          'Recommended: scope the bot to a single server. Enable Developer Mode in Discord, right-click the server, Copy Server ID.',
        ),
      },
      {
        id: 'defaultChannelId',
        type: 'text',
        label: t('channel_discord.connect.fields.defaultChannelId', 'Default channel ID'),
        placeholder: SNOWFLAKE_PLACEHOLDER,
        description: t(
          'channel_discord.connect.fields.defaultChannelIdHelp',
          'Default text channel the adapter posts to when an outbound message names no Discord channel. To verify it, call the hub test-send endpoint with an empty JSON body ({}) so no recipient is named, or pass a channel snowflake as the recipient to post somewhere else.',
        ),
      },
    ],
    [t],
  )

  const handleSubmit = React.useCallback(
    async (values: DiscordConnectFormValues) => {
      const body = buildDiscordConnectRequestBody(values)
      await runMutation({
        context: mutationContext,
        mutationPayload: { providerKey: body.providerKey, displayName: body.displayName },
        operation: async () => {
          const call = await apiCall('/api/communication_channels/channels/connect/credentials', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          })
          if (!call.ok) {
            await raiseCrudError(
              call.response,
              t('channel_discord.connect.failed', 'Could not connect Discord bot.'),
            )
          }
          return call
        },
      })
      flash(t('channel_discord.connect.connected', 'Discord channel connected.'), 'success')
      setOpen(false)
      widgetContext?.reload?.()
    },
    [mutationContext, runMutation, t, widgetContext],
  )

  const onDialogKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || !(event.metaKey || event.ctrlKey) || event.key !== 'Enter') return
    event.preventDefault()
    const form = document.getElementById(FORM_ID)
    if (form instanceof HTMLFormElement) form.requestSubmit()
  }, [])

  return (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        {t('channel_discord.connect.button', 'Connect Discord')}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent onKeyDown={onDialogKeyDown}>
          <DialogHeader>
            <DialogTitle>{t('channel_discord.connect.title', 'Connect Discord bot')}</DialogTitle>
            <DialogDescription>
              {t(
                'channel_discord.connect.description',
                'Creates a Discord channel you own: its messages land in your inbox and you can send through it. The bot credentials are checked with Discord before anything is saved.',
              )}
            </DialogDescription>
          </DialogHeader>
          {open ? (
            <CrudForm<DiscordConnectFormValues>
              formId={FORM_ID}
              schema={schema}
              fields={fields}
              initialValues={DISCORD_CONNECT_INITIAL_VALUES}
              submitLabel={t('channel_discord.connect.save', 'Connect')}
              onSubmit={handleSubmit}
              embedded
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  )
}
