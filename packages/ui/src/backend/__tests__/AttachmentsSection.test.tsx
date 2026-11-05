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
//
// The fixtures below answer the way `/api/attachments` itself answers, which is
// not how the other load-more surfaces answer: the route clamps the requested
// page to the last one, for the offset (`route.ts:215-216`) and for the page it
// echoes back (`:259`). A request past the end therefore returns the last page
// in full rather than an empty one. Hand-written fixtures that return a short
// page past the end describe an endpoint that does not exist, and they hid a
// live defect here.
describe('AttachmentsSection load-more termination', () => {
  const PAGE_SIZE = 24

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

  /**
   * Emulates `/api/attachments` over a fixed row count: clamps both the offset
   * and the echoed `page` to the last page, exactly as the route does. Records
   * every page actually requested so a non-terminating sequence is visible.
   */
  const respondLikeClampingRoute = (total: number) => {
    const requestedPages: number[] = []
    ;(apiCall as jest.Mock).mockImplementation((url: string) => {
      if (url.startsWith('/api/attachments?')) {
        const requested = Number(new URL(url, 'http://test').searchParams.get('page') ?? '1')
        requestedPages.push(requested)
        const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
        const servedPage = Math.min(requested, totalPages)
        const offset = (servedPage - 1) * PAGE_SIZE
        const count = Math.max(0, Math.min(PAGE_SIZE, total - offset))
        return Promise.resolve({
          ok: true,
          status: 200,
          result: {
            items: makeItems(count, offset),
            total,
            page: servedPage,
            pageSize: PAGE_SIZE,
            totalPages,
          },
          response: { status: 200 },
        })
      }
      return Promise.resolve({ ok: true, status: 200, result: {}, response: { status: 200 } })
    })
    return { requestedPages }
  }

  beforeEach(() => {
    jest.resetAllMocks()
  })

  it('offers Load more on a full page even when totalPages says otherwise', async () => {
    respondWith([
      { items: makeItems(24), total: 3, page: 1, pageSize: 24, totalPages: 1 },
      // The route cannot echo a page above `totalPages`, so page 2 here is
      // served as page 2 of a list whose reported total is simply wrong — the
      // under-reporting case this guard exists for.
      { items: makeItems(2, 24), total: 3, page: 2, pageSize: 24, totalPages: 2 },
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

  // The count being an exact multiple of the page size is the case that breaks:
  // the first page is full, so the affordance is offered, and the request it
  // makes is answered with that same page re-served. One wasted request is the
  // accepted cost of short-page termination; appending its rows is not.
  it('terminates when the count is an exact multiple of the page size', async () => {
    const { requestedPages } = respondLikeClampingRoute(24)

    renderWithProviders(
      <AttachmentsSection entityId="customers:customer_entity" recordId="record-1" />,
      { dict: {} },
    )

    const loadMore = await screen.findByRole('button', { name: 'Load more' })
    fireEvent.click(loadMore)

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull()
    })
    // The clamped answer must not be appended: one row per attachment.
    expect(screen.getAllByText('File 1.pdf')).toHaveLength(1)
    expect(screen.getAllByText('File 24.pdf')).toHaveLength(1)
    // Asking once past the end is how the end is discovered; asking twice is
    // the non-terminating loop.
    expect(requestedPages).toEqual([1, 2])
  })

  it('pages to the end of a multi-page list without duplicating the last page', async () => {
    const { requestedPages } = respondLikeClampingRoute(48)

    renderWithProviders(
      <AttachmentsSection entityId="customers:customer_entity" recordId="record-1" />,
      { dict: {} },
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Load more' }))
    expect(await screen.findByText('File 48.pdf')).toBeInTheDocument()

    // Page 2 was full, so the affordance is offered again; page 3 comes back
    // clamped to page 2 and must end the sequence rather than re-append it.
    fireEvent.click(await screen.findByRole('button', { name: 'Load more' }))

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull()
    })
    expect(screen.getAllByText('File 25.pdf')).toHaveLength(1)
    expect(screen.getAllByText('File 48.pdf')).toHaveLength(1)
    expect(requestedPages).toEqual([1, 2, 3])
  })
})
