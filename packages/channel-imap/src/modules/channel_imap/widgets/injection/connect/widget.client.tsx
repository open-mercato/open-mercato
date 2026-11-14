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
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import {
  IMAP_CONNECT_INITIAL_VALUES,
  buildImapConnectRequestBody,
  createImapConnectFormSchema,
  type ImapConnectFormValues,
} from '../../../lib/connect-form'

type WidgetContext = Record<string, unknown> & {
  reload?: () => void
}

const FORM_ID = 'channel-imap-connect-form'

export default function ConnectImapWidget({
  context,
}: InjectionWidgetComponentProps<Record<string, unknown>, Record<string, unknown>>) {
  const t = useT()
  const widgetContext = context as WidgetContext | undefined
  const [open, setOpen] = React.useState(false)
  const { runMutation, retryLastMutation } = useGuardedMutation({
    contextId: 'channel-imap-connect',
    blockedMessage: t('communication_channels.profile.connect.blocked', 'Connection blocked by validation'),
  })
  const mutationContext = React.useMemo(
    () => ({ providerKey: 'imap', retryLastMutation }),
    [retryLastMutation],
  )

  const schema = React.useMemo(() => createImapConnectFormSchema(t), [t])

  const fields = React.useMemo<CrudField[]>(() => {
    const tlsOptions = [
      { value: 'tls', label: t('communication_channels.profile.connect.tls.tls', 'TLS') },
      { value: 'starttls', label: t('communication_channels.profile.connect.tls.starttls', 'STARTTLS') },
      { value: 'none', label: t('communication_channels.profile.connect.tls.none', 'None') },
    ]
    return [
      {
        id: 'displayName',
        type: 'text',
        label: t('communication_channels.profile.connect.fields.displayName', 'Display name'),
      },
      {
        id: 'fromAddress',
        type: 'text',
        label: t('communication_channels.profile.connect.fields.fromAddress', 'From address'),
        required: true,
      },
      {
        id: 'imapHost',
        type: 'text',
        label: t('communication_channels.profile.connect.fields.imapHost', 'IMAP host'),
        required: true,
        layout: 'half',
      },
      {
        id: 'imapPort',
        type: 'number',
        label: t('communication_channels.profile.connect.fields.imapPort', 'IMAP port'),
        required: true,
        layout: 'half',
      },
      {
        id: 'imapTls',
        type: 'select',
        label: t('communication_channels.profile.connect.fields.imapTls', 'IMAP security'),
        options: tlsOptions,
        required: true,
        layout: 'half',
      },
      {
        id: 'imapUser',
        type: 'text',
        label: t('communication_channels.profile.connect.fields.imapUser', 'IMAP username'),
        required: true,
        layout: 'half',
      },
      {
        id: 'imapPassword',
        type: 'password',
        label: t('communication_channels.profile.connect.fields.imapPassword', 'IMAP password'),
        required: true,
      },
      {
        id: 'smtpHost',
        type: 'text',
        label: t('communication_channels.profile.connect.fields.smtpHost', 'SMTP host'),
        required: true,
        layout: 'half',
      },
      {
        id: 'smtpPort',
        type: 'number',
        label: t('communication_channels.profile.connect.fields.smtpPort', 'SMTP port'),
        required: true,
        layout: 'half',
      },
      {
        id: 'smtpTls',
        type: 'select',
        label: t('communication_channels.profile.connect.fields.smtpTls', 'SMTP security'),
        options: tlsOptions,
        required: true,
        layout: 'half',
      },
      {
        id: 'smtpUser',
        type: 'text',
        label: t('communication_channels.profile.connect.fields.smtpUser', 'SMTP username'),
        layout: 'half',
      },
      {
        id: 'smtpPassword',
        type: 'password',
        label: t('communication_channels.profile.connect.fields.smtpPassword', 'SMTP password'),
      },
    ]
  }, [t])

  const handleSubmit = React.useCallback(
    async (values: ImapConnectFormValues) => {
      const body = buildImapConnectRequestBody(values)
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
              t('communication_channels.profile.connect.credentialsFailed', 'Could not connect mailbox.'),
            )
          }
          return call
        },
      })
      flash(t('communication_channels.profile.connect.connected', 'Channel connected.'), 'success')
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
        {t('communication_channels.profile.connect.imap', 'Connect IMAP')}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent onKeyDown={onDialogKeyDown}>
          <DialogHeader>
            <DialogTitle>
              {t('communication_channels.profile.connect.imapTitle', 'Connect IMAP mailbox')}
            </DialogTitle>
          </DialogHeader>
          {open ? (
            <CrudForm<ImapConnectFormValues>
              formId={FORM_ID}
              schema={schema}
              fields={fields}
              initialValues={IMAP_CONNECT_INITIAL_VALUES}
              submitLabel={t('communication_channels.profile.connect.save', 'Connect')}
              onSubmit={handleSubmit}
              embedded
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  )
}
