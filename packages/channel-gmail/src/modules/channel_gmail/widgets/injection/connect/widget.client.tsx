'use client'

import * as React from 'react'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { SocialButton } from '@open-mercato/ui/primitives/social-button'
import { useConnectChannel } from '@open-mercato/core/modules/communication_channels/lib/use-connect-channel'

export default function ConnectGmailWidget(
  _props: InjectionWidgetComponentProps<Record<string, unknown>, Record<string, unknown>>,
) {
  const t = useT()
  const { connect, pending } = useConnectChannel({ providerKey: 'gmail' })

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
