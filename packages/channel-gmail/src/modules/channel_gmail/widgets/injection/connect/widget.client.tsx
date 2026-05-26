'use client'

import * as React from 'react'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { SocialButton } from '@open-mercato/ui/primitives/social-button'

type InitiateResponse = { authorizeUrl?: string; error?: string }

export default function ConnectGmailWidget(
  _props: InjectionWidgetComponentProps<Record<string, unknown>, Record<string, unknown>>,
) {
  const t = useT()
  const [pending, setPending] = React.useState(false)
  const { runMutation, retryLastMutation } = useGuardedMutation({
    contextId: 'channel-gmail-connect',
    blockedMessage: t('communication_channels.profile.connect.blocked', 'Connection blocked by validation'),
  })
  const mutationContext = React.useMemo(
    () => ({ providerKey: 'gmail', retryLastMutation }),
    [retryLastMutation],
  )

  const connect = React.useCallback(async () => {
    if (pending) return
    setPending(true)
    try {
      const response = await runMutation({
        context: mutationContext,
        mutationPayload: { providerKey: 'gmail' },
        operation: () =>
          apiCall<InitiateResponse>('/api/communication_channels/oauth/gmail/initiate', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              returnUrl: '/backend/profile/communication-channels',
            }),
          }),
      })
      const body = response.result as InitiateResponse | undefined
      if (!response.ok || !body?.authorizeUrl) {
        flash(
          body?.error ??
            t('communication_channels.profile.connect.oauthFailed', 'Could not start OAuth connection.'),
          'error',
        )
        return
      }
      window.location.assign(body.authorizeUrl)
    } finally {
      setPending(false)
    }
  }, [mutationContext, pending, runMutation, t])

  return (
    <SocialButton
      type="button"
      brand="google"
      appearance="stroke"
      onClick={() => void connect()}
      disabled={pending}
    >
      {pending
        ? t('communication_channels.profile.connect.connecting', 'Connecting...')
        : t('communication_channels.profile.connect.gmail', 'Connect Gmail')}
    </SocialButton>
  )
}
