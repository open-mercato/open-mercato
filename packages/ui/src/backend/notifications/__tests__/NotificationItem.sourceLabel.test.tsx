import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { createTranslator } from '@open-mercato/shared/lib/i18n/translate'
import type { NotificationDto } from '@open-mercato/shared/modules/notifications/types'
import { NotificationItem } from '../NotificationItem'
import polishAuthDictionary from '../../../../../core/src/modules/auth/i18n/pl.json'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
}))

function renderSource(sourceModule?: string | null, dictionary: Record<string, string> = {}) {
  const notification: NotificationDto = {
    id: 'source-label',
    type: 'auth.role.assigned',
    title: 'Role assigned',
    severity: 'info',
    status: 'read',
    actions: [],
    createdAt: '2026-11-14T00:00:00.000Z',
    sourceModule,
  }
  return render(
    <NotificationItem
      notification={notification}
      onMarkAsRead={jest.fn().mockResolvedValue(undefined)}
      onExecuteAction={jest.fn().mockResolvedValue({})}
      onDismiss={jest.fn().mockResolvedValue(undefined)}
      t={createTranslator(dictionary)}
    />,
  )
}

describe('NotificationItem source label', () => {
  it('uses the shipped Polish module name when no notification override exists', () => {
    expect(polishAuthDictionary['auth.acl.modules.auth']).toBe('Uwierzytelnianie i konta')
    renderSource('auth', polishAuthDictionary)

    expect(screen.getByText('Uwierzytelnianie i konta')).toBeInTheDocument()
    expect(screen.queryByText('Auth')).not.toBeInTheDocument()
  })

  it('renders the translated source name from the notification dictionary', () => {
    renderSource('auth', {
      ...polishAuthDictionary,
      'notifications.sources.auth': 'Niestandardowe źródło',
    })

    expect(screen.getByText('Niestandardowe źródło')).toBeInTheDocument()
    expect(screen.queryByText('Uwierzytelnianie i konta')).not.toBeInTheDocument()
  })

  it.each([
    ['auth', 'Auth'],
    ['custom_module:some.feature-name', 'Custom Module Some Feature Name'],
  ])('humanizes %s when its translation is absent', (moduleId, label) => {
    renderSource(moduleId)

    expect(screen.getByText(label)).toBeInTheDocument()
  })

  it.each([undefined, null, ''])('omits an absent source (%s)', (sourceModule) => {
    const { container } = renderSource(sourceModule, {
      'notifications.sources.undefined': 'Unexpected source',
      'notifications.sources.null': 'Unexpected source',
      'notifications.sources.': 'Unexpected source',
    })

    expect(screen.queryByText('Unexpected source')).not.toBeInTheDocument()
    expect(container.querySelector('span.truncate')).not.toBeInTheDocument()
  })
})
