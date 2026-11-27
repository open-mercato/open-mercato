'use client'

import * as React from 'react'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { OAuthProviderSetupHint } from '@open-mercato/core/modules/communication_channels/components/OAuthProviderSetupHint'
import { useConnectChannel } from '@open-mercato/core/modules/communication_channels/lib/use-connect-channel'
import { useOAuthProviderStatus } from '@open-mercato/core/modules/communication_channels/lib/use-oauth-provider-status'

/**
 * "Connect Microsoft 365" button for the per-user channels page. The whole
 * OAuth initiate + redirect flow lives in the shared `useConnectChannel` hook,
 * and the workspace setup check in the shared `useOAuthProviderStatus` hook
 * (same readiness flow as the Gmail widget); this widget only supplies the
 * button chrome. A plain DS `Button` is used (like IMAP) because
 * `SocialButton` has no Microsoft brand yet — adding one touches
 * design-system governance files and is a separate follow-up.
 */
export default function ConnectMs365Widget(
  _props: InjectionWidgetComponentProps<Record<string, unknown>, Record<string, unknown>>,
) {
  const t = useT()
  const descriptionId = React.useId()
  const { status, retry, markUnconfigured } = useOAuthProviderStatus('ms365')
  const { connect, pending } = useConnectChannel({
    providerKey: 'ms365',
    onNotConfigured: markUnconfigured,
  })

  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        variant="outline"
        onClick={() => void connect()}
        disabled={pending || status !== 'configured'}
        aria-describedby={status === 'configured' ? undefined : descriptionId}
      >
        {pending
          ? t('communication_channels.profile.connect.connecting', 'Connecting...')
          : t('communication_channels.profile.connect.ms365', 'Connect Microsoft 365')}
      </Button>
      {status !== 'configured' ? (
        <div id={descriptionId} className="max-w-64 space-y-1 text-sm text-muted-foreground">
          {status === 'checking' ? (
            <p role="status">
              {t('communication_channels.profile.connect.checkingSetup', 'Checking provider setup…')}
            </p>
          ) : status === 'unconfigured' ? (
            <p><OAuthProviderSetupHint providerKey="ms365" /></p>
          ) : (
            <>
              <p>{t('communication_channels.profile.connect.setupUnavailable', 'Could not check provider setup.')}</p>
              <Button type="button" variant="link" className="h-auto p-0" onClick={retry}>
                {t('communication_channels.profile.connect.retrySetup', 'Retry')}
              </Button>
            </>
          )}
        </div>
      ) : null}
    </div>
  )
}
