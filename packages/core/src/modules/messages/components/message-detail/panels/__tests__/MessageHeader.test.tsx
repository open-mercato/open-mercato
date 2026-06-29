/**
 * @jest-environment jsdom
 */

import { render, screen } from '@testing-library/react'
import { MessageHeader } from '../MessageHeader'
import type { MessageDetail } from '../../types'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (_key: string, fallback?: string) => fallback ?? _key,
}))

jest.mock('@open-mercato/ui/backend/forms', () => ({
  FormHeader: ({ menuActions }: { menuActions: Array<{ id: string; label: string }> }) => (
    <div>
      {menuActions.map((action) => (
        <button key={action.id} type="button">
          {action.label}
        </button>
      ))}
    </div>
  ),
}))

function makeDetail(overrides: Partial<MessageDetail> = {}): MessageDetail {
  return {
    id: 'message-1',
    updatedAt: '2026-06-25T10:00:00.000Z',
    type: 'default',
    isDraft: false,
    canEditDraft: false,
    canArchive: true,
    isArchived: false,
    typeDefinition: {
      labelKey: 'messages.types.default',
      icon: 'mail',
      allowReply: true,
      allowForward: true,
    },
    senderUserId: 'user-1',
    senderName: 'Sender',
    senderEmail: 'sender@example.com',
    subject: 'Subject',
    body: 'Body',
    bodyFormat: 'text',
    priority: 'normal',
    sentAt: '2026-06-25T10:00:00.000Z',
    actionData: null,
    actionTaken: null,
    actionTakenAt: null,
    actionTakenByUserId: null,
    recipients: [],
    objects: [],
    thread: [],
    isRead: true,
    ...overrides,
  }
}

function renderHeader(detail: MessageDetail) {
  render(
    <MessageHeader
      detail={detail}
      updatingState={false}
      isArchived={detail.isArchived}
      onReply={jest.fn()}
      onForward={jest.fn()}
      onEdit={jest.fn()}
      onToggleRead={jest.fn()}
      onToggleArchive={jest.fn()}
      onDelete={jest.fn()}
    />,
  )
}

describe('MessageHeader archive action', () => {
  it('hides message-level archive when the actor cannot archive the message', () => {
    renderHeader(makeDetail({ canArchive: false }))

    expect(screen.queryByRole('button', { name: 'Archive' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument()
  })

  it('shows message-level archive for recipient-visible messages', () => {
    renderHeader(makeDetail({ canArchive: true, isArchived: false }))

    expect(screen.getByRole('button', { name: 'Archive' })).toBeInTheDocument()
  })

  it('shows unarchive for archived recipient-visible messages', () => {
    renderHeader(makeDetail({ canArchive: true, isArchived: true }))

    expect(screen.getByRole('button', { name: 'Unarchive' })).toBeInTheDocument()
  })
})
