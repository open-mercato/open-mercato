'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'

type InitiateResponse = { authorizeUrl?: string; error?: string; code?: string }

/**
 * Shared OAuth "connect" flow for email channel provider widgets (Gmail and
 * other OAuth providers). Wraps the guarded-mutation contract + `/oauth/<provider>/initiate`
 * call + redirect, so each provider widget only supplies its own button chrome.
 */
export function useConnectChannel(options: {
  providerKey: string
  returnUrl?: string
}): { connect: () => Promise<void>; pending: boolean } {
  const { providerKey } = options
  const returnUrl = options.returnUrl ?? '/backend/profile/communication-channels'
  const t = useT()
  const [pending, setPending] = React.useState(false)
  const { runMutation, retryLastMutation } = useGuardedMutation({
    contextId: `channel-${providerKey}-connect`,
    blockedMessage: t('communication_channels.profile.connect.blocked', 'Connection blocked by validation'),
  })
  const mutationContext = React.useMemo(
    () => ({ providerKey, retryLastMutation }),
    [providerKey, retryLastMutation],
  )

  const connect = React.useCallback(async () => {
    if (pending) return
    setPending(true)
    try {
      const response = await runMutation({
        context: mutationContext,
        mutationPayload: { providerKey },
        operation: () =>
          apiCall<InitiateResponse>(`/api/communication_channels/oauth/${providerKey}/initiate`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ returnUrl }),
          }),
      })
      const body = response.result as InitiateResponse | undefined
      if (!response.ok || !body?.authorizeUrl) {
        if (body?.code === 'oauth_client_not_configured') {
          flash(
            t(
              'communication_channels.profile.connect.notConfigured',
              'This provider is not configured yet. Ask an administrator to add the OAuth Client ID and Secret under Integrations before connecting a mailbox.',
            ),
            'error',
          )
          return
        }
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
  }, [mutationContext, pending, providerKey, returnUrl, runMutation, t])

  return { connect, pending }
}
