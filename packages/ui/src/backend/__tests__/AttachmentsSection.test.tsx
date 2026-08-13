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

// The load-more guard used to be `page < totalPages`. A `totalPages` derived
// from an under-reporting total — a capped list count, or rows added between
// requests — hid the button and made the remaining attachments unreachable.
// Termination now follows the page being full.
describe('AttachmentsSection load-more termination', () => {
  const makeItems = (count: number, offset = 0) =>
    Array.from({ length: count }, (_, index) => ({
      id: `attachment-${offset + index + 1}`,
      fileName: `File ${offset + index + 1}.pdf`,
      fileSize: 1024,
      mimeType: 'application/pdf',
      thumbnailUrl: null,
      tags: [],
      assignments: [],
      customFieldValues: {},
    }))

  const respondWith = (pages: Array<Record<string, unknown>>) => {
    let call = 0
    ;(apiCall as jest.Mock).mockImplementation((url: string) => {
      if (url.startsWith('/api/attachments?')) {
        const payload = pages[Math.min(call, pages.length - 1)]
        call += 1
        return Promise.resolve({ ok: true, status: 200, result: payload, response: { status: 200 } })
      }
      return Promise.resolve({ ok: true, status: 200, result: {}, response: { status: 200 } })
    })
  }

  beforeEach(() => {
    jest.resetAllMocks()
  })

  it('offers Load more on a full page even when totalPages says otherwise', async () => {
    respondWith([
      { items: makeItems(24), total: 3, page: 1, pageSize: 24, totalPages: 1 },
      { items: makeItems(2, 24), total: 3, page: 2, pageSize: 24, totalPages: 1 },
    ])

    renderWithProviders(
      <AttachmentsSection entityId="customers:customer_entity" recordId="record-1" />,
      { dict: {} },
    )

    const loadMore = await screen.findByRole('button', { name: 'Load more' })
    fireEvent.click(loadMore)

    expect(await screen.findByText('File 25.pdf')).toBeInTheDocument()
  })

  it('hides Load more once a page comes back short', async () => {
    respondWith([
      { items: makeItems(3), total: 999, page: 1, pageSize: 24, totalPages: 42 },
    ])

    renderWithProviders(
      <AttachmentsSection entityId="customers:customer_entity" recordId="record-1" />,
      { dict: {} },
    )

    expect(await screen.findByText('File 1.pdf')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull()
    })
  })
})
