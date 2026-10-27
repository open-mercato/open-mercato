/** @jest-environment jsdom */
import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import type { NotificationRendererProps } from '@open-mercato/shared/modules/notifications/types'
import serverNotificationTypes from '../notifications'
import clientNotificationTypes, {
  ACTIONABLE_NOTIFICATION_TYPE,
  resolveActionableNotificationView,
} from '../notifications.client'

const dict = {
  'common.open': 'Open',
  'notifications.actions.dismiss': 'Dismiss',
}

function actionableTypeDefinition() {
  const definition = clientNotificationTypes.find((entry) => entry.type === ACTIONABLE_NOTIFICATION_TYPE)
  expect(definition).toBeDefined()
  return definition!
}

function renderActionable(overrides: Partial<NotificationRendererProps> = {}) {
  const definition = actionableTypeDefinition()
  const Renderer = definition.Renderer
  expect(Renderer).toBeDefined()
  const RendererComponent = Renderer!

  const onAction = overrides.onAction ?? jest.fn(async () => {})
  const onDismiss = overrides.onDismiss ?? jest.fn(async () => {})
  const notification: NotificationRendererProps['notification'] = {
    id: 'notification-1',
    type: ACTIONABLE_NOTIFICATION_TYPE,
    title: 'Action required in UMES next phases',
    body: 'Open the UMES next phases page.',
    severity: 'info',
    status: 'unread',
    createdAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
    ...(overrides.notification ?? {}),
  }

  render(
    <I18nProvider locale="en" dict={dict}>
      <RendererComponent
        notification={notification}
        actions={overrides.actions ?? definition.actions}
        onAction={onAction}
        onDismiss={onDismiss}
      />
    </I18nProvider>,
  )
  return { onAction, onDismiss }
}

describe('example notifications.client.ts', () => {
  it('re-declares the server notification types verbatim and never invents an id', () => {
    expect(clientNotificationTypes.map((entry) => entry.type))
      .toEqual(serverNotificationTypes.map((entry) => entry.type))
    expect(clientNotificationTypes.map((entry) => entry.type)).toContain(ACTIONABLE_NOTIFICATION_TYPE)

    for (const client of clientNotificationTypes) {
      const server = serverNotificationTypes.find((entry) => entry.type === client.type)
      expect(server).toBeDefined()
      const { Renderer: _clientRenderer, ...clientRest } = client
      const { Renderer: _serverRenderer, ...serverRest } = server!
      expect(clientRest).toEqual(serverRest)
    }
  })

  it('attaches a renderer to the actionable type', () => {
    expect(actionableTypeDefinition().Renderer).toBeDefined()
    expect(serverNotificationTypes.find((entry) => entry.type === ACTIONABLE_NOTIFICATION_TYPE)?.Renderer)
      .toBeUndefined()
  })

  it('resolves the declared actions into a primary and a dismiss action', () => {
    const definition = actionableTypeDefinition()
    const view = resolveActionableNotificationView('unread', definition.actions)
    expect(view.isUnread).toBe(true)
    expect(view.primaryAction?.id).toBe('open')
    expect(view.dismissAction?.id).toBe('dismiss')

    expect(resolveActionableNotificationView('read', definition.actions).isUnread).toBe(false)
    expect(resolveActionableNotificationView('unread', []).primaryAction).toBeNull()
  })

  it('renders the notification through translated action labels', () => {
    renderActionable()
    expect(screen.getByText('Action required in UMES next phases')).toBeInTheDocument()
    expect(screen.getByText('Open the UMES next phases page.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument()
  })

  it('invokes onAction with the primary action id and onDismiss from the dismiss button', async () => {
    const { onAction, onDismiss } = renderActionable()

    fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    await waitFor(() => expect(onAction).toHaveBeenCalledWith('open'))
    expect(onDismiss).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    await waitFor(() => expect(onDismiss).toHaveBeenCalledTimes(1))
    expect(onAction).toHaveBeenCalledTimes(1)
  })
})
