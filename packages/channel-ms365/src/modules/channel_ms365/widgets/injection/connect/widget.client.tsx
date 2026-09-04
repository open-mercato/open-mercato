'use client'

import * as React from 'react'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { useConnectChannel } from '@open-mercato/core/modules/communication_channels/lib/use-connect-channel'

/**
 * "Connect Microsoft 365" button for the per-user channels page. The whole
 * OAuth initiate + redirect flow lives in the shared `useConnectChannel` hook;
 * this widget only supplies the button chrome. A plain DS `Button` is used
 * (like IMAP) because `SocialButton` has no Microsoft brand yet — adding one
 * touches design-system governance files and is a separate follow-up.
 */
export default function ConnectMs365Widget(
  _props: InjectionWidgetComponentProps<Record<string, unknown>, Record<string, unknown>>,
) {
  const t = useT()
  const { connect, pending } = useConnectChannel({ providerKey: 'ms365' })

  return (
    <Button type="button" variant="outline" onClick={() => void connect()} disabled={pending}>
      {pending
        ? t('communication_channels.profile.connect.connecting', 'Connecting...')
        : t('communication_channels.profile.connect.ms365', 'Connect Microsoft 365')}
    </Button>
  )
}
