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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'

type WidgetContext = Record<string, unknown> & {
  reload?: () => void
}

type ConnectResponse = {
  channelId?: string
  error?: string
  fieldErrors?: Record<string, string>
}

type TlsMode = 'tls' | 'starttls' | 'none'

type FormState = {
  displayName: string
  fromAddress: string
  imapHost: string
  imapPort: string
  imapTls: TlsMode
  imapUser: string
  imapPassword: string
  smtpHost: string
  smtpPort: string
  smtpTls: TlsMode
  smtpUser: string
  smtpPassword: string
}

const INITIAL_FORM: FormState = {
  displayName: '',
  fromAddress: '',
  imapHost: '',
  imapPort: '993',
  imapTls: 'tls',
  imapUser: '',
  imapPassword: '',
  smtpHost: '',
  smtpPort: '465',
  smtpTls: 'tls',
  smtpUser: '',
  smtpPassword: '',
}

export default function ConnectImapWidget({
  context,
}: InjectionWidgetComponentProps<Record<string, unknown>, Record<string, unknown>>) {
  const t = useT()
  const widgetContext = context as WidgetContext | undefined
  const [open, setOpen] = React.useState(false)
  const [pending, setPending] = React.useState(false)
  const [form, setForm] = React.useState<FormState>(INITIAL_FORM)
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({})
  const { runMutation, retryLastMutation } = useGuardedMutation({
    contextId: 'channel-imap-connect',
    blockedMessage: t('communication_channels.profile.connect.blocked', 'Connection blocked by validation'),
  })
  const mutationContext = React.useMemo(
    () => ({ providerKey: 'imap', retryLastMutation }),
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
        mutationPayload: { providerKey: 'imap', displayName: form.displayName },
        operation: () =>
          apiCall<ConnectResponse>('/api/communication_channels/channels/connect/credentials', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              providerKey: 'imap',
              displayName: form.displayName.trim() || form.fromAddress.trim(),
              pollIntervalSeconds: 300,
              credentials: {
                imapHost: form.imapHost.trim(),
                imapPort: Number(form.imapPort),
                imapTls: form.imapTls,
                imapUser: form.imapUser.trim(),
                imapPassword: form.imapPassword,
                smtpHost: form.smtpHost.trim(),
                smtpPort: Number(form.smtpPort),
                smtpTls: form.smtpTls,
                smtpUser: (form.smtpUser.trim() || form.imapUser.trim()),
                smtpPassword: form.smtpPassword || form.imapPassword,
                fromAddress: form.fromAddress.trim(),
              },
            }),
          }),
      })
      const body = response.result as ConnectResponse | undefined
      if (!response.ok) {
        setFieldErrors(body?.fieldErrors ?? {})
        flash(
          body?.error ??
            t('communication_channels.profile.connect.credentialsFailed', 'Could not connect mailbox.'),
          'error',
        )
        return
      }
      flash(t('communication_channels.profile.connect.connected', 'Channel connected.'), 'success')
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
        {t('communication_channels.profile.connect.imap', 'Connect IMAP')}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent onKeyDown={onDialogKeyDown}>
          <DialogHeader>
            <DialogTitle>
              {t('communication_channels.profile.connect.imapTitle', 'Connect IMAP mailbox')}
            </DialogTitle>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            <Field
              label={t('communication_channels.profile.connect.fields.displayName', 'Display name')}
              error={fieldErrors.displayName}
            >
              <Input
                value={form.displayName}
                onChange={(event) => update('displayName', event.target.value)}
                aria-invalid={Boolean(fieldErrors.displayName)}
              />
            </Field>
            <Field
              label={t('communication_channels.profile.connect.fields.fromAddress', 'From address')}
              error={fieldErrors.fromAddress}
            >
              <Input
                type="email"
                value={form.fromAddress}
                onChange={(event) => update('fromAddress', event.target.value)}
                aria-invalid={Boolean(fieldErrors.fromAddress)}
              />
            </Field>

            <div className="grid gap-3 md:grid-cols-2">
              <Field
                label={t('communication_channels.profile.connect.fields.imapHost', 'IMAP host')}
                error={fieldErrors.imapHost}
              >
                <Input
                  value={form.imapHost}
                  onChange={(event) => update('imapHost', event.target.value)}
                  aria-invalid={Boolean(fieldErrors.imapHost)}
                />
              </Field>
              <Field
                label={t('communication_channels.profile.connect.fields.imapPort', 'IMAP port')}
                error={fieldErrors.imapPort}
              >
                <Input
                  inputMode="numeric"
                  value={form.imapPort}
                  onChange={(event) => update('imapPort', event.target.value)}
                  aria-invalid={Boolean(fieldErrors.imapPort)}
                />
              </Field>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <Field
                label={t('communication_channels.profile.connect.fields.imapTls', 'IMAP security')}
                error={fieldErrors.imapTls}
              >
                <TlsSelect value={form.imapTls} onChange={(value) => update('imapTls', value)} />
              </Field>
              <Field
                label={t('communication_channels.profile.connect.fields.imapUser', 'IMAP username')}
                error={fieldErrors.imapUser}
              >
                <Input
                  value={form.imapUser}
                  onChange={(event) => update('imapUser', event.target.value)}
                  aria-invalid={Boolean(fieldErrors.imapUser)}
                />
              </Field>
            </div>

            <Field
              label={t('communication_channels.profile.connect.fields.imapPassword', 'IMAP password')}
              error={fieldErrors.imapPassword}
            >
              <PasswordInput
                value={form.imapPassword}
                onChange={(event) => update('imapPassword', event.target.value)}
                aria-invalid={Boolean(fieldErrors.imapPassword)}
              />
            </Field>

            <div className="grid gap-3 md:grid-cols-2">
              <Field
                label={t('communication_channels.profile.connect.fields.smtpHost', 'SMTP host')}
                error={fieldErrors.smtpHost}
              >
                <Input
                  value={form.smtpHost}
                  onChange={(event) => update('smtpHost', event.target.value)}
                  aria-invalid={Boolean(fieldErrors.smtpHost)}
                />
              </Field>
              <Field
                label={t('communication_channels.profile.connect.fields.smtpPort', 'SMTP port')}
                error={fieldErrors.smtpPort}
              >
                <Input
                  inputMode="numeric"
                  value={form.smtpPort}
                  onChange={(event) => update('smtpPort', event.target.value)}
                  aria-invalid={Boolean(fieldErrors.smtpPort)}
                />
              </Field>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <Field
                label={t('communication_channels.profile.connect.fields.smtpTls', 'SMTP security')}
                error={fieldErrors.smtpTls}
              >
                <TlsSelect value={form.smtpTls} onChange={(value) => update('smtpTls', value)} />
              </Field>
              <Field
                label={t('communication_channels.profile.connect.fields.smtpUser', 'SMTP username')}
                error={fieldErrors.smtpUser}
              >
                <Input
                  value={form.smtpUser}
                  onChange={(event) => update('smtpUser', event.target.value)}
                  aria-invalid={Boolean(fieldErrors.smtpUser)}
                />
              </Field>
            </div>

            <Field
              label={t('communication_channels.profile.connect.fields.smtpPassword', 'SMTP password')}
              error={fieldErrors.smtpPassword}
            >
              <PasswordInput
                value={form.smtpPassword}
                onChange={(event) => update('smtpPassword', event.target.value)}
                aria-invalid={Boolean(fieldErrors.smtpPassword)}
              />
            </Field>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              {t('communication_channels.profile.connect.cancel', 'Cancel')}
            </Button>
            <Button type="button" onClick={() => void submit()} disabled={pending}>
              {pending
                ? t('communication_channels.profile.connect.connecting', 'Connecting...')
                : t('communication_channels.profile.connect.save', 'Connect')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function Field(props: {
  label: string
  error?: string
  children: React.ReactNode
}) {
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

function TlsSelect(props: { value: TlsMode; onChange: (value: TlsMode) => void }) {
  const t = useT()
  return (
    <Select value={props.value} onValueChange={(value) => props.onChange(value as TlsMode)}>
      <SelectTrigger>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="tls">
          {t('communication_channels.profile.connect.tls.tls', 'TLS')}
        </SelectItem>
        <SelectItem value="starttls">
          {t('communication_channels.profile.connect.tls.starttls', 'STARTTLS')}
        </SelectItem>
        <SelectItem value="none">
          {t('communication_channels.profile.connect.tls.none', 'None')}
        </SelectItem>
      </SelectContent>
    </Select>
  )
}
