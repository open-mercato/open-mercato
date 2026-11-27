'use client'

import * as React from 'react'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { SocialButton } from '@open-mercato/ui/primitives/social-button'
import { OAuthProviderSetupHint } from '@open-mercato/core/modules/communication_channels/components/OAuthProviderSetupHint'
import { useConnectChannel } from '@open-mercato/core/modules/communication_channels/lib/use-connect-channel'
import { useOAuthProviderStatus } from '@open-mercato/core/modules/communication_channels/lib/use-oauth-provider-status'

export default function ConnectGmailWidget(
  _props: InjectionWidgetComponentProps<Record<string, unknown>, Record<string, unknown>>,
) {
  const t = useT()
  const descriptionId = React.useId()
  const { status, retry, markUnconfigured } = useOAuthProviderStatus('gmail')
  const { connect, pending } = useConnectChannel({
    providerKey: 'gmail',
    onNotConfigured: markUnconfigured,
  })

  return (
    <div className="flex flex-col gap-2">
      <SocialButton
        type="button"
        brand="google"
        appearance="stroke"
        onClick={() => void connect()}
        disabled={pending || status !== 'configured'}
        aria-describedby={status === 'configured' ? undefined : descriptionId}
      >
        {pending
          ? t('communication_channels.profile.connect.connecting', 'Connecting...')
          : t('communication_channels.profile.connect.gmail', 'Connect Gmail')}
      </SocialButton>
      {status !== 'configured' ? (
        <div id={descriptionId} className="max-w-64 space-y-1 text-sm text-muted-foreground">
          {status === 'checking' ? (
            <p role="status">
              {t('communication_channels.profile.connect.checkingSetup', 'Checking provider setup…')}
            </p>
          ) : status === 'unconfigured' ? (
            <p><OAuthProviderSetupHint providerKey="gmail" /></p>
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
