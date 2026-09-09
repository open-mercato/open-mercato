'use client'

import * as React from 'react'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { PasswordInput } from '@open-mercato/ui/primitives/password-input'

type WidgetContext = Record<string, unknown> & {
  reload?: () => void
}

type ConnectResponse = {
  channelId?: string
  error?: string
  fieldErrors?: Record<string, string>
}

type FormState = {
  displayName: string
  botToken: string
  applicationId: string
  publicKey: string
  guildId: string
  defaultChannelId: string
}

const INITIAL_FORM: FormState = {
  displayName: '',
  botToken: '',
  applicationId: '',
  publicKey: '',
  guildId: '',
  defaultChannelId: '',
}

export default function ConnectDiscordWidget({
  context,
}: InjectionWidgetComponentProps<Record<string, unknown>, Record<string, unknown>>) {
  const t = useT()
  const widgetContext = context as WidgetContext | undefined
  const [open, setOpen] = React.useState(false)
  const [pending, setPending] = React.useState(false)
  const [form, setForm] = React.useState<FormState>(INITIAL_FORM)
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({})
  const { runMutation, retryLastMutation } = useGuardedMutation({
    contextId: 'channel-discord-connect',
    blockedMessage: t('channel_discord.connect.blocked', 'Connection blocked by validation'),
  })
  const mutationContext = React.useMemo(
    () => ({ providerKey: 'discord', retryLastMutation }),
    [retryLastMutation],
  )

  const update = React.useCallback(
    <K extends keyof FormState>(key: K, value: FormState[K]) => {
      setForm((current) => ({ ...current, [key]: value }))
      setFieldErrors((current) => {
        if (!current[key]) return current
        const next = { ...current }
        delete next[key]
        return next
      })
    },
    [],
  )

  const submit = React.useCallback(async () => {
    if (pending) return
    setPending(true)
    setFieldErrors({})
    try {
      const response = await runMutation({
        context: mutationContext,
        mutationPayload: { providerKey: 'discord', displayName: form.displayName },
        operation: () =>
          apiCall<ConnectResponse>('/api/communication_channels/channels/connect/credentials', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              providerKey: 'discord',
              displayName: form.displayName.trim() || 'Discord',
              credentials: {
                botToken: form.botToken.trim(),
                applicationId: form.applicationId.trim(),
                publicKey: form.publicKey.trim(),
                guildId: form.guildId.trim() || undefined,
                defaultChannelId: form.defaultChannelId.trim() || undefined,
              },
            }),
          }),
      })
      const body = response.result as ConnectResponse | undefined
      if (!response.ok) {
        setFieldErrors(body?.fieldErrors ?? {})
        flash(body?.error ?? t('channel_discord.connect.failed', 'Could not connect Discord bot.'), 'error')
        return
      }
      flash(t('channel_discord.connect.connected', 'Discord channel connected.'), 'success')
      setOpen(false)
      setForm(INITIAL_FORM)
      widgetContext?.reload?.()
    } finally {
      setPending(false)
    }
  }, [form, mutationContext, pending, runMutation, t, widgetContext])

  const onDialogKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        void submit()
      }
    },
    [submit],
  )

  return (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        {t('channel_discord.connect.button', 'Connect Discord')}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent onKeyDown={onDialogKeyDown}>
          <DialogHeader>
            <DialogTitle>{t('channel_discord.connect.title', 'Connect Discord bot')}</DialogTitle>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            <Field
              label={t('channel_discord.connect.fields.displayName', 'Display name')}
              error={fieldErrors.displayName}
            >
              <Input
                value={form.displayName}
                onChange={(event) => update('displayName', event.target.value)}
                aria-invalid={Boolean(fieldErrors.displayName)}
              />
            </Field>

            <Field
              label={t('channel_discord.connect.fields.botToken', 'Bot token')}
              error={fieldErrors.botToken}
            >
              <PasswordInput
                value={form.botToken}
                onChange={(event) => update('botToken', event.target.value)}
                aria-invalid={Boolean(fieldErrors.botToken)}
              />
            </Field>

            <div className="grid gap-3 md:grid-cols-2">
              <Field
                label={t('channel_discord.connect.fields.applicationId', 'Application ID')}
                error={fieldErrors.applicationId}
              >
                <Input
                  value={form.applicationId}
                  onChange={(event) => update('applicationId', event.target.value)}
                  aria-invalid={Boolean(fieldErrors.applicationId)}
                />
              </Field>
              <Field
                label={t('channel_discord.connect.fields.publicKey', 'Public key')}
                error={fieldErrors.publicKey}
              >
                <Input
                  value={form.publicKey}
                  onChange={(event) => update('publicKey', event.target.value)}
                  aria-invalid={Boolean(fieldErrors.publicKey)}
                />
              </Field>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <Field
                label={t('channel_discord.connect.fields.guildId', 'Guild (server) ID')}
                error={fieldErrors.guildId}
              >
                <Input
                  value={form.guildId}
                  onChange={(event) => update('guildId', event.target.value)}
                  aria-invalid={Boolean(fieldErrors.guildId)}
                />
              </Field>
              <Field
                label={t('channel_discord.connect.fields.defaultChannelId', 'Default channel ID')}
                error={fieldErrors.defaultChannelId}
              >
                <Input
                  value={form.defaultChannelId}
                  onChange={(event) => update('defaultChannelId', event.target.value)}
                  aria-invalid={Boolean(fieldErrors.defaultChannelId)}
                />
              </Field>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              {t('channel_discord.connect.cancel', 'Cancel')}
            </Button>
            <Button type="button" onClick={() => void submit()} disabled={pending}>
              {pending
                ? t('channel_discord.connect.connecting', 'Connecting...')
                : t('channel_discord.connect.save', 'Connect')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function Field(props: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5">
      <Label asChild>
        <span>{props.label}</span>
      </Label>
      {props.children}
      {props.error ? <span className="text-xs text-destructive">{props.error}</span> : null}
    </label>
  )
}
