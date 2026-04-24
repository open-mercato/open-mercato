/** @jest-environment jsdom */

import * as React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { AttachmentsSection } from '../detail/AttachmentsSection'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
}))

jest.mock('../injection/useRegisteredComponent', () => ({
  useRegisteredComponent: <T,>(_handle: string, fallback?: React.ComponentType<T>) =>
    fallback ?? ((() => null) as React.ComponentType<T>),
}))

jest.mock('../detail/AttachmentMetadataDialog', () => ({
  AttachmentMetadataDialog: ({
    open,
    item,
  }: {
    open: boolean
    item: { fileName?: string | null } | null
  }) => (open ? <div data-testid="attachment-metadata-dialog">{item?.fileName ?? 'unknown'}</div> : null),
}))

jest.mock('../detail/AttachmentDeleteDialog', () => ({
  AttachmentDeleteDialog: () => null,
}))

describe('AttachmentsSection', () => {
  beforeEach(() => {
    jest.resetAllMocks()
    ;(apiCall as jest.Mock).mockImplementation((url: string) => {
      if (url.startsWith('/api/attachments?')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          result: {
            items: [
              {
                id: 'attachment-1',
                fileName: 'Quarterly Report.pdf',
                fileSize: 2048,
                mimeType: 'application/pdf',
                thumbnailUrl: null,
                tags: [],
                assignments: [],
                customFieldValues: {},
              },
            ],
          },
          response: { status: 200 },
        })
      }

      return Promise.resolve({
        ok: true,
        status: 200,
        result: {},
        response: { status: 200 },
      })
    })
  })

  it('renders attachment cards without nesting buttons and keeps keyboard activation', async () => {
    const { container } = renderWithProviders(
      <AttachmentsSection entityId="customers:customer_entity" recordId="record-1" />,
      { dict: {} },
    )

    const card = await screen.findByRole('button', { name: /quarterly report\.pdf/i })
    expect(container.querySelectorAll('button button')).toHaveLength(0)

    fireEvent.keyDown(card, { key: 'Enter' })

    await waitFor(() => {
      expect(screen.getByTestId('attachment-metadata-dialog')).toHaveTextContent('Quarterly Report.pdf')
    })
  })
})
