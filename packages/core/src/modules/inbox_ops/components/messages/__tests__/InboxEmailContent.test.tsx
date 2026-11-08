/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import type { MessageContentProps } from '@open-mercato/shared/modules/messages/types'
import { InboxEmailContent } from '../InboxEmailContent'

const apiCallMock = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
}))

const EMAIL_ID = '33333333-3333-4333-8333-333333333333'

function props(objects: MessageContentProps['objects']): MessageContentProps {
  return {
    message: {
      id: 'message-1',
      type: 'inbox_ops.email',
      subject: 'Offer 42',
      body: 'Please see the attached offer.',
      bodyFormat: 'text',
      priority: 'normal',
      sentAt: null,
      senderUserId: 'user-1',
    },
    objects,
    attachments: [],
  } as MessageContentProps
}

const EMAIL_OBJECT = { id: 'object-1', entityModule: 'inbox_ops', entityType: 'inbox_email', entityId: EMAIL_ID, actionRequired: false }

beforeEach(() => {
  apiCallMock.mockReset()
})

describe('InboxEmailContent attachments', () => {
  it('lists the attachments of the linked inbox email', async () => {
    apiCallMock.mockResolvedValue({
      ok: true,
      status: 200,
      result: { items: [{ id: 'part-1', partKey: 'resend:a', fileName: 'offer.pdf', mimeType: 'application/pdf', sizeBytes: 10, disposition: 'attachment', status: 'stored', reason: null, attachmentId: 'att-1', url: '/api/attachments/file/att-1' }] },
    })
    renderWithProviders(<InboxEmailContent {...props([EMAIL_OBJECT])} />)
    expect(await screen.findByText('offer.pdf')).toBeTruthy()
    expect(screen.getByText('Attachments')).toBeTruthy()
    expect(apiCallMock.mock.calls[0][0]).toBe(`/api/inbox_ops/emails/${EMAIL_ID}/attachments`)
  })

  it.each([403, 404])('hides the section when the list route answers %s', async (status) => {
    apiCallMock.mockResolvedValue({ ok: false, status, result: { error: 'Forbidden' } })
    renderWithProviders(<InboxEmailContent {...props([EMAIL_OBJECT])} />)
    await waitFor(() => expect(screen.queryByText('Loading attachments...')).toBeNull())
    expect(screen.queryByText('Attachments')).toBeNull()
    expect(screen.getByText('Please see the attached offer.')).toBeTruthy()
  })

  it('hides the section for an email without attachments', async () => {
    apiCallMock.mockResolvedValue({ ok: true, status: 200, result: { items: [] } })
    renderWithProviders(<InboxEmailContent {...props([EMAIL_OBJECT])} />)
    await waitFor(() => expect(screen.queryByText('Loading attachments...')).toBeNull())
    expect(screen.queryByText('Attachments')).toBeNull()
  })

  it('requests nothing when the message links no inbox email', () => {
    renderWithProviders(<InboxEmailContent {...props([{ ...EMAIL_OBJECT, entityModule: 'sales', entityType: 'sales_order' }])} />)
    expect(apiCallMock).not.toHaveBeenCalled()
    expect(screen.queryByText('Attachments')).toBeNull()
  })
})
