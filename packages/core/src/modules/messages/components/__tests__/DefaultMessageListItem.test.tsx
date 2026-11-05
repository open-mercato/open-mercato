/**
 * @jest-environment jsdom
 */

import { render, screen } from '@testing-library/react'
import { DefaultMessageListItem } from '../defaults/DefaultMessageListItem'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (_key: string, fallback?: string) => fallback ?? '',
}))

describe('DefaultMessageListItem', () => {
  it('uses informative placeholders for missing recipients and subjects', () => {
    render(
      <DefaultMessageListItem
        message={{
          id: 'message-1',
          type: 'default',
          subject: '',
          body: '',
          bodyFormat: 'text',
          priority: 'normal',
          sentAt: new Date('2026-05-18T10:00:00.000Z'),
          senderName: '',
          hasObjects: false,
          hasAttachments: false,
          hasActions: false,
          unread: false,
        }}
        onClick={jest.fn()}
      />,
    )

    expect(screen.getByText('(No recipient)')).toBeInTheDocument()
    expect(screen.getByText('(No subject)')).toBeInTheDocument()
    expect(screen.queryByText('—')).not.toBeInTheDocument()
  })
})
