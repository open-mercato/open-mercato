'use client'

import * as React from 'react'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { useConnectChannel } from '@open-mercato/core/modules/communication_channels/lib/use-connect-channel'

export default function ConnectMicrosoftWidget(
  _props: InjectionWidgetComponentProps<Record<string, unknown>, Record<string, unknown>>,
) {
  const t = useT()
  const { connect, pending } = useConnectChannel({ providerKey: 'microsoft' })

  return (
    <Button type="button" variant="outline" onClick={() => void connect()} disabled={pending}>
      {pending
        ? t('communication_channels.profile.connect.connecting', 'Connecting...')
        : t('communication_channels.profile.connect.microsoft', 'Connect Microsoft 365')}
    </Button>
  )
}
