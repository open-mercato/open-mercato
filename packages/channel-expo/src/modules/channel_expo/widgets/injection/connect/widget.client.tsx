'use client'

import * as React from 'react'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { resolvePushConnectErrorMessage } from '@open-mercato/core/modules/communication_channels/lib/push-connect-error'
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
  code?: string
  fieldErrors?: Record<string, string>
}

type FormState = {
  displayName: string
  accessToken: string
}

const INITIAL_FORM: FormState = {
  displayName: 'Expo Push',
  accessToken: '',
}

export default function ConnectExpoWidget({
  context,
}: InjectionWidgetComponentProps<Record<string, unknown>, Record<string, unknown>>) {
  const t = useT()
  const widgetContext = context as WidgetContext | undefined
  const [open, setOpen] = React.useState(false)
  const [pending, setPending] = React.useState(false)
  const [form, setForm] = React.useState<FormState>(INITIAL_FORM)
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({})
  const { runMutation, retryLastMutation } = useGuardedMutation({
    contextId: 'channel-expo-connect',
    blockedMessage: t('communication_channels.push.connect.blocked', 'Connection blocked by validation'),
  })
  const mutationContext = React.useMemo(
    () => ({ providerKey: 'expo', retryLastMutation }),
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
    const displayName = form.displayName.trim() || 'Expo Push'
    try {
      const response = await runMutation({
        context: mutationContext,
        mutationPayload: { providerKey: 'expo', displayName },
        operation: () =>
          apiCall<ConnectResponse>('/api/communication_channels/channels/connect/tenant-credentials', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              providerKey: 'expo',
              displayName,
              credentials: {
                ...(form.accessToken.trim() ? { accessToken: form.accessToken.trim() } : {}),
              },
            }),
          }),
      })
      const body = response.result as ConnectResponse | undefined
      if (!response.ok) {
        setFieldErrors(body?.fieldErrors ?? {})
        flash(resolvePushConnectErrorMessage(t, body), 'error')
        return
      }
      flash(t('communication_channels.push.connect.connected', 'Push provider connected.'), 'success')
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
        {t('communication_channels.push.connect.button.expo', 'Connect Expo')}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent onKeyDown={onDialogKeyDown}>
          <DialogHeader>
            <DialogTitle>
              {t('communication_channels.push.connect.title.expo', 'Connect Expo Push')}
            </DialogTitle>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            <p className="text-sm text-muted-foreground">
              {t(
                'communication_channels.push.connect.description',
                "This is a shared, tenant-wide channel — every user's devices in this workspace are served by it.",
              )}
            </p>
            <Field
              label={t('communication_channels.push.connect.displayName', 'Display name')}
              error={fieldErrors.displayName}
            >
              <Input
                value={form.displayName}
                onChange={(event) => update('displayName', event.target.value)}
                aria-invalid={Boolean(fieldErrors.displayName)}
              />
            </Field>
            <Field
              label={t('communication_channels.push.connect.fields.expo.accessToken', 'Access token (optional)')}
              error={fieldErrors.accessToken}
            >
              <PasswordInput
                value={form.accessToken}
                onChange={(event) => update('accessToken', event.target.value)}
                aria-invalid={Boolean(fieldErrors.accessToken)}
              />
            </Field>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              {t('communication_channels.push.connect.cancel', 'Cancel')}
            </Button>
            <Button type="button" onClick={() => void submit()} disabled={pending}>
              {pending
                ? t('communication_channels.push.connect.connecting', 'Connecting…')
                : t('communication_channels.push.connect.save', 'Connect')}
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
