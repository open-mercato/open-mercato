/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { NotificationItem } from '../NotificationItem'
import type { NotificationDto } from '@open-mercato/shared/modules/notifications/types'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    prefetch: jest.fn(),
    refresh: jest.fn(),
    back: jest.fn(),
    forward: jest.fn(),
  }),
}))

const PL_TRANSLATIONS: Record<string, string> = {
  'notifications.actionTaken': 'Wykonana akcja: {action}',
  'staff.notifications.leaveRequest.actions.approve': 'Zatwierdź',
  'staff.notifications.leaveRequest.actions.reject': 'Odrzuć',
}

function makeTranslate(translations: Record<string, string>): TranslateFn {
  return ((key: string, fallbackOrVars?: unknown, vars?: Record<string, string>) => {
    const fallback = typeof fallbackOrVars === 'string' ? fallbackOrVars : undefined
    const variables = typeof fallbackOrVars === 'object' && fallbackOrVars !== null
      ? (fallbackOrVars as Record<string, string>)
      : vars
    let template = translations[key] ?? fallback ?? key
    if (variables) {
      for (const [name, value] of Object.entries(variables)) {
        template = template.replace(`{${name}}`, value)
      }
    }
    return template
  }) as TranslateFn
}

function buildNotification(overrides: Partial<NotificationDto>): NotificationDto {
  return {
    id: 'n-1',
    type: 'staff.leave_request.pending',
    title: 'Leave request pending',
    severity: 'info',
    status: 'actioned',
    actions: [
      { id: 'approve', label: 'Approve', labelKey: 'staff.notifications.leaveRequest.actions.approve' },
      { id: 'reject', label: 'Reject', labelKey: 'staff.notifications.leaveRequest.actions.reject' },
    ],
    createdAt: '2026-09-25T00:00:00.000Z',
    ...overrides,
  }
}

function renderItem(notification: NotificationDto, t: TranslateFn) {
  render(
    <NotificationItem
      notification={notification}
      onMarkAsRead={jest.fn().mockResolvedValue(undefined)}
      onExecuteAction={jest.fn().mockResolvedValue({})}
      onDismiss={jest.fn().mockResolvedValue(undefined)}
      t={t}
    />,
  )
}

describe('NotificationItem action-taken label', () => {
  it('shows the translated button label for the clicked action, not the internal action id', () => {
    renderItem(buildNotification({ actionTaken: 'approve' }), makeTranslate(PL_TRANSLATIONS))

    expect(screen.getByText('Wykonana akcja: Zatwierdź')).toBeInTheDocument()
    expect(screen.queryByText(/approve/)).not.toBeInTheDocument()
  })

  it('translates a different action id to its own label', () => {
    renderItem(buildNotification({ actionTaken: 'reject' }), makeTranslate(PL_TRANSLATIONS))

    expect(screen.getByText('Wykonana akcja: Odrzuć')).toBeInTheDocument()
  })

  it('falls back to the plain label when the action has no labelKey', () => {
    renderItem(
      buildNotification({
        actionTaken: 'view',
        actions: [{ id: 'view', label: 'View' }],
      }),
      makeTranslate({ 'notifications.actionTaken': 'Action taken: {action}' }),
    )

    expect(screen.getByText('Action taken: View')).toBeInTheDocument()
  })

  it('falls back to the raw action id when no matching action is found', () => {
    renderItem(
      buildNotification({ actionTaken: 'unknown-action', actions: [] }),
      makeTranslate({ 'notifications.actionTaken': 'Action taken: {action}' }),
    )

    expect(screen.getByText('Action taken: unknown-action')).toBeInTheDocument()
  })
})
