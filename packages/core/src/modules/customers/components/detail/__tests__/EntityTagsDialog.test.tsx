/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { EntityTagsDialog } from '../EntityTagsDialog'

const apiCallMock = jest.fn()
const readApiResultOrThrowMock = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
  apiCallOrThrow: jest.fn(),
  readApiResultOrThrow: (...args: unknown[]) => readApiResultOrThrowMock(...args),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

jest.mock('../ManageTagsDialog', () => ({
  ManageTagsDialog: ({ open }: { open: boolean }) => (open ? <div>manage-tags-dialog</div> : null),
}))

// Mirrors `REMOTE_CATEGORY_PAGE_SIZE` in the dialog. A page that comes back
// with this many entries is the only "there may be more" signal the load-more
// affordance reads.
const REMOTE_CATEGORY_PAGE_SIZE = 50

function makeTagEntries(
  count: number,
  prefix = 'filler',
  labelPrefix = 'Filler',
): Array<{ id: string; value: string; label: string; color: string | null }> {
  return Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-${index + 1}`,
    value: `${prefix}-${index + 1}`,
    label: `${labelPrefix} ${index + 1}`,
    color: null,
  }))
}

function makeLabelEntries(count: number) {
  return makeTagEntries(count, 'label', 'Label')
}

describe('EntityTagsDialog', () => {
  beforeEach(() => {
    apiCallMock.mockReset()
    readApiResultOrThrowMock.mockReset()
    apiCallMock.mockImplementation((url: string) => {
      if (url.startsWith('/api/customers/tags?')) {
        const parsed = new URL(url, 'http://localhost')
        const page = parsed.searchParams.get('page') ?? '1'
        const search = parsed.searchParams.get('search') ?? ''
        if (search === 'priority') {
          return Promise.resolve({
            ok: true,
            result: {
              items: [{ id: 'tag-priority', value: 'tag-priority', label: 'Priority', color: '#4ade80' }],
              totalPages: 1,
            },
          })
        }
        // Page 1 comes back full, page 2 short — the shape a query-engine list
        // actually emits, and what the dialog now terminates on.
        return Promise.resolve({
          ok: true,
          result: {
            items: page === '2'
              ? [{ id: 'tag-2', value: 'tag-2', label: 'VIP', color: '#f59e0b' }]
              : [
                  { id: 'tag-1', value: 'tag-1', label: 'Prospect', color: '#60a5fa' },
                  ...makeTagEntries(REMOTE_CATEGORY_PAGE_SIZE - 1),
                ],
            totalPages: 2,
          },
        })
      }
      if (url.startsWith('/api/customers/labels?')) {
        return Promise.resolve({
          ok: true,
          result: {
            items: [],
            assignedIds: [],
            totalPages: 1,
          },
        })
      }
      if (url.startsWith('/api/customers/dictionaries/sources')) {
        return Promise.resolve({
          ok: true,
          result: {
            items: [
              { id: 'src-1', value: 'customer_referral', label: 'Customer referral', color: '#4ade80' },
              { id: 'src-2', value: 'outbound_campaign', label: 'Outbound campaign', color: '#f59e0b' },
            ],
          },
        })
      }
      if (url.startsWith('/api/customers/dictionaries/job-titles')) {
        return Promise.resolve({
          ok: true,
          result: {
            items: [
              { id: 'job-1', value: 'vp_sales', label: 'VP Sales', color: null },
            ],
          },
        })
      }
      if (url.startsWith('/api/customers/dictionaries/industries')) {
        return Promise.resolve({
          ok: true,
          result: {
            items: [
              { id: 'ind-1', value: 'solar', label: 'Solar', color: null },
            ],
          },
        })
      }
      return Promise.resolve({ ok: true, result: { items: [] } })
    })
    readApiResultOrThrowMock.mockResolvedValue({ items: [], assignedIds: [] })
  })

  it('opens tag settings from the manage-tags modal header', async () => {
    await act(async () => {
      renderWithProviders(
        <EntityTagsDialog
          open
          onClose={jest.fn()}
          entityId="person-1"
          entityType="person"
          entityOrganizationId="org-1"
          entityData={{}}
        />,
      )
    })

    expect(screen.getAllByRole('button', { name: 'Tag settings' })).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: 'Tag settings' }))

    expect(screen.getByText('manage-tags-dialog')).toBeInTheDocument()
  })

  it('filters options within the active category and keeps the category model scoped', async () => {
    await act(async () => {
      renderWithProviders(
        <EntityTagsDialog
          open
          onClose={jest.fn()}
          entityId="person-1"
          entityType="person"
          entityOrganizationId="org-1"
          entityData={{ source: 'outbound_campaign' }}
        />,
      )
    })

    fireEvent.click(screen.getByRole('button', { name: /^Source\b/ }))

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Search source...')).toBeInTheDocument()
    })

    expect(screen.getByText('Outbound campaign')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Search source...')).toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText('Search source...'), {
      target: { value: 'customer' },
    })

    expect(screen.getByText('Customer referral')).toBeInTheDocument()
    expect(screen.queryByText('Outbound campaign')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Job title\b/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Industry\b/ })).not.toBeInTheDocument()
  })

  it('uses company-specific categories when editing company tags', async () => {
    await act(async () => {
      renderWithProviders(
        <EntityTagsDialog
          open
          onClose={jest.fn()}
          entityId="company-1"
          entityType="company"
          entityOrganizationId="org-1"
          entityData={{ industry: 'solar' }}
        />,
      )
    })

    expect(screen.getByRole('button', { name: /^Industry\b/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Job title\b/ })).not.toBeInTheDocument()
  })

  it('loads paged tag options remotely and applies tag search server-side', async () => {
    await act(async () => {
      renderWithProviders(
        <EntityTagsDialog
          open
          onClose={jest.fn()}
          entityId="person-1"
          entityType="person"
          entityOrganizationId="org-1"
          entityData={{}}
        />,
      )
    })

    await waitFor(() => {
      expect(apiCallMock).toHaveBeenCalledWith(
        '/api/customers/tags?page=1&pageSize=50',
        expect.any(Object),
      )
    })

    expect(screen.getByText('Prospect')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))

    await waitFor(() => {
      expect(apiCallMock).toHaveBeenCalledWith(
        '/api/customers/tags?page=2&pageSize=50',
        expect.any(Object),
      )
    })

    await waitFor(() => {
      expect(screen.getByText('VIP')).toBeInTheDocument()
    })
    // Page 2 was short, so the sequence is over even though `totalPages` said 2.
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull()

    fireEvent.change(screen.getByPlaceholderText('Search tags...'), {
      target: { value: 'priority' },
    })

    await waitFor(() => {
      expect(apiCallMock).toHaveBeenCalledWith(
        '/api/customers/tags?page=1&pageSize=50&search=priority',
        expect.any(Object),
      )
    })

    await waitFor(() => {
      expect(screen.getByText('Priority')).toBeInTheDocument()
    })
    expect(screen.queryByText('Prospect')).not.toBeInTheDocument()
  })

  // The affordance used to be gated on `activeCategoryPage < activeCategoryTotalPages`.
  // When the reported total under-reports the result set — tags created between
  // two requests, or a capped list count — the button vanished and every tag
  // past the reported end became unreachable. Termination now follows the page
  // coming back short.
  describe('load-more termination', () => {
    const respondToTagsWith = (respond: (page: string) => { items: unknown[]; totalPages: number }) => {
      const fallback = apiCallMock.getMockImplementation()!
      apiCallMock.mockImplementation((url: string, ...rest: unknown[]) => {
        if (url.startsWith('/api/customers/tags?')) {
          const page = new URL(url, 'http://localhost').searchParams.get('page') ?? '1'
          return Promise.resolve({ ok: true, result: respond(page) })
        }
        return fallback(url, ...rest)
      })
    }

    // The dialog drives two endpoints from one affordance, and they paginate
    // differently — `/api/customers/labels` is hand-rolled and clamps the
    // requested page, so it needs its own harness rather than the suite's
    // default empty-page stub.
    const respondToLabelsWith = (
      respond: (page: string) => { ok?: boolean; items?: unknown[]; page?: number; totalPages?: number },
    ) => {
      const fallback = apiCallMock.getMockImplementation()!
      apiCallMock.mockImplementation((url: string, ...rest: unknown[]) => {
        if (url.startsWith('/api/customers/labels?')) {
          const page = new URL(url, 'http://localhost').searchParams.get('page') ?? '1'
          const { ok = true, ...result } = respond(page)
          return Promise.resolve({ ok, result: { assignedIds: [], ...result } })
        }
        return fallback(url, ...rest)
      })
    }

    const openLabelsCategory = () => {
      fireEvent.click(screen.getByRole('button', { name: /^Labels\b/ }))
    }

    const renderDialog = async () => {
      await act(async () => {
        renderWithProviders(
          <EntityTagsDialog
            open
            onClose={jest.fn()}
            entityId="person-1"
            entityType="person"
            entityOrganizationId="org-1"
            entityData={{}}
          />,
        )
      })
    }

    it('offers Load more on a full page even when totalPages reports a single page', async () => {
      respondToTagsWith(() => ({ items: makeTagEntries(REMOTE_CATEGORY_PAGE_SIZE), totalPages: 1 }))

      await renderDialog()

      expect(await screen.findByRole('button', { name: 'Load more' })).toBeInTheDocument()
    })

    it('hides Load more once a page comes back short, whatever totalPages promises', async () => {
      respondToTagsWith(() => ({ items: makeTagEntries(3), totalPages: 99 }))

      await renderDialog()

      expect(await screen.findByText('Filler 1')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull()
    })

    // `/api/customers/tags` is query-engine backed and computes an unclamped
    // offset, so the page past the end comes back empty rather than re-serving
    // the last one. That empty page is what ends the sequence.
    it('stops on the empty page past the end', async () => {
      respondToTagsWith((page) =>
        page === '1'
          ? { items: makeTagEntries(REMOTE_CATEGORY_PAGE_SIZE), totalPages: 1 }
          : { items: [], totalPages: 1 })

      await renderDialog()

      fireEvent.click(await screen.findByRole('button', { name: 'Load more' }))

      await waitFor(() => {
        expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull()
      })
      expect(screen.getByText('Filler 50')).toBeInTheDocument()
    })

    // The flag belongs to the active category exactly as the page number does:
    // switching to a category whose first page is short must not inherit the
    // previous category's affordance. Labels serves a genuinely short page here
    // rather than an empty one, so the assertion fails if the reset is dropped
    // instead of passing because the category had no entries at all.
    it('keeps the affordance keyed to the active category', async () => {
      respondToTagsWith(() => ({ items: makeTagEntries(REMOTE_CATEGORY_PAGE_SIZE), totalPages: 1 }))
      respondToLabelsWith(() => ({ items: makeLabelEntries(3), page: 1, totalPages: 1 }))

      await renderDialog()

      expect(await screen.findByRole('button', { name: 'Load more' })).toBeInTheDocument()

      openLabelsCategory()

      expect(await screen.findByText('Label 1')).toBeInTheDocument()
      await waitFor(() => {
        expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull()
      })
    })

    // The inverse direction: a category whose first page is full must gain the
    // affordance after one whose page was short, so the reset recomputes the
    // flag rather than merely clearing it.
    it('re-offers the affordance when the next category has a full first page', async () => {
      respondToTagsWith(() => ({ items: makeTagEntries(3), totalPages: 1 }))
      respondToLabelsWith(() => ({ items: makeLabelEntries(REMOTE_CATEGORY_PAGE_SIZE), page: 1, totalPages: 1 }))

      await renderDialog()

      expect(await screen.findByText('Filler 1')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull()

      openLabelsCategory()

      expect(await screen.findByRole('button', { name: 'Load more' })).toBeInTheDocument()
    })

    it('hides Load more once a labels page comes back short', async () => {
      respondToLabelsWith((page) =>
        page === '1'
          ? { items: makeLabelEntries(REMOTE_CATEGORY_PAGE_SIZE), page: 1, totalPages: 1 }
          : { items: makeLabelEntries(2), page: 2, totalPages: 2 })

      await renderDialog()
      openLabelsCategory()

      fireEvent.click(await screen.findByRole('button', { name: 'Load more' }))

      await waitFor(() => {
        expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull()
      })
      expect(screen.getByText('Label 50')).toBeInTheDocument()
    })

    // `/api/customers/labels` pages an in-memory array and clamps the requested
    // page to the last one (`api/labels/route.ts`), so a request past the end
    // re-serves the last page in full — for ever. The served count alone can
    // never terminate there; the echoed page is what ends the sequence. This is
    // obligation 2 in the `hasMoreFromPage` docstring.
    it('terminates when the labels endpoint clamps the page past the end', async () => {
      const lastPage = makeLabelEntries(REMOTE_CATEGORY_PAGE_SIZE)
      respondToLabelsWith(() => ({ items: lastPage, page: 1, totalPages: 1 }))

      await renderDialog()
      openLabelsCategory()

      fireEvent.click(await screen.findByRole('button', { name: 'Load more' }))

      await waitFor(() => {
        expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull()
      })
      expect(screen.getByText('Label 1')).toBeInTheDocument()
      expect(screen.getByText('Label 50')).toBeInTheDocument()
    })

    // A transport failure is not an end-of-list signal. Clearing the flag on a
    // failed fetch would strand the user on a partial list with no way back;
    // advancing the page on the retry would skip the page that failed.
    it('keeps a retry affordance when a page fails to load', async () => {
      respondToLabelsWith((page) =>
        page === '1'
          ? { items: makeLabelEntries(REMOTE_CATEGORY_PAGE_SIZE), page: 1, totalPages: 2 }
          : { ok: false, items: [] })

      await renderDialog()
      openLabelsCategory()

      fireEvent.click(await screen.findByRole('button', { name: 'Load more' }))

      const retry = await screen.findByRole('button', { name: 'Retry' })
      expect(retry).toBeInTheDocument()
      expect(screen.getByText('Label 1')).toBeInTheDocument()

      const requestedPages = () =>
        apiCallMock.mock.calls
          .map(([url]: [string]) => url)
          .filter((url: string) => typeof url === 'string' && url.startsWith('/api/customers/labels?'))
          .map((url: string) => new URL(url, 'http://localhost').searchParams.get('page'))

      const before = requestedPages().length
      fireEvent.click(retry)

      await waitFor(() => {
        expect(requestedPages().length).toBeGreaterThan(before)
      })
      // The retry re-requests the page that failed rather than advancing past it.
      expect(requestedPages().slice(before)).toEqual(['2'])
    })
  })

  it('includes tenant-defined custom categories from kind settings', async () => {
    apiCallMock.mockImplementation((url: string) => {
      if (url.startsWith('/api/customers/dictionaries/kind-settings')) {
        return Promise.resolve({
          ok: true,
          result: {
            items: [
              {
                kind: 'partner-stage',
                selectionMode: 'multi',
                visibleInTags: true,
                sortOrder: 50,
              },
            ],
          },
        })
      }
      if (url.startsWith('/api/customers/dictionaries/partner-stage')) {
        return Promise.resolve({
          ok: true,
          result: {
            items: [
              { id: 'stage-1', value: 'champion', label: 'Champion', color: '#4ade80' },
            ],
          },
        })
      }
      return Promise.resolve({ ok: true, result: { items: [] } })
    })

    await act(async () => {
      renderWithProviders(
        <EntityTagsDialog
          open
          onClose={jest.fn()}
          entityId="person-1"
          entityType="person"
          entityOrganizationId="org-1"
          entityData={{ customFields: { 'crmTagCategory:partner-stage': ['champion'] } }}
        />,
      )
    })

    fireEvent.click(screen.getByRole('button', { name: /^Partner Stage\b/ }))

    expect(screen.getByText('Champion')).toBeInTheDocument()
  })

  it('fans out independent dictionary requests in parallel instead of waterfalling', async () => {
    const requestedDictionaries = new Set<string>()
    let releaseDictionaries: () => void = () => {}
    const dictionaryGate = new Promise<void>((resolve) => {
      releaseDictionaries = resolve
    })

    apiCallMock.mockImplementation((url: string) => {
      if (url.startsWith('/api/customers/dictionaries/kind-settings')) {
        return Promise.resolve({ ok: true, result: { items: [] } })
      }
      if (url.startsWith('/api/customers/labels?')) {
        return Promise.resolve({ ok: true, result: { items: [], assignedIds: [], totalPages: 1 } })
      }
      if (url.startsWith('/api/customers/dictionaries/')) {
        requestedDictionaries.add(new URL(url, 'http://localhost').pathname)
        return dictionaryGate.then(() => ({ ok: true, result: { items: [] } }))
      }
      return Promise.resolve({ ok: true, result: { items: [] } })
    })

    await act(async () => {
      renderWithProviders(
        <EntityTagsDialog
          open
          onClose={jest.fn()}
          entityId="person-1"
          entityType="person"
          entityOrganizationId="org-1"
          entityData={{}}
        />,
      )
    })

    // The previous sequential loop awaited each dictionary in turn, so while the
    // gate is held only the first request would have been issued. The parallel
    // fan-out issues every person dictionary category before any resolves.
    await waitFor(() => {
      expect(requestedDictionaries).toEqual(
        new Set([
          '/api/customers/dictionaries/statuses',
          '/api/customers/dictionaries/lifecycle-stages',
          '/api/customers/dictionaries/sources',
          '/api/customers/dictionaries/temperature',
          '/api/customers/dictionaries/renewal-quarters',
          '/api/customers/dictionaries/job-titles',
        ]),
      )
    })

    await act(async () => {
      releaseDictionaries()
    })
  })

  it('keeps unrelated categories working and falls back when one dictionary request fails', async () => {
    apiCallMock.mockImplementation((url: string) => {
      if (url.startsWith('/api/customers/dictionaries/kind-settings')) {
        return Promise.resolve({ ok: true, result: { items: [] } })
      }
      if (url.startsWith('/api/customers/labels?')) {
        return Promise.resolve({ ok: true, result: { items: [], assignedIds: [], totalPages: 1 } })
      }
      if (url.startsWith('/api/customers/dictionaries/sources')) {
        return Promise.reject(new Error('network down'))
      }
      if (url.startsWith('/api/customers/dictionaries/statuses')) {
        return Promise.resolve({
          ok: true,
          result: { items: [{ id: 'status-1', value: 'active', label: 'Active', color: null }] },
        })
      }
      return Promise.resolve({ ok: true, result: { items: [] } })
    })

    await act(async () => {
      renderWithProviders(
        <EntityTagsDialog
          open
          onClose={jest.fn()}
          entityId="person-1"
          entityType="person"
          entityOrganizationId="org-1"
          entityData={{ source: 'outbound_campaign', status: 'active' }}
        />,
      )
    })

    // The failed Source dictionary still produces a fallback entry for the
    // record's current value, scoped to that category only.
    fireEvent.click(screen.getByRole('button', { name: /^Source\b/ }))
    expect(screen.getByText('outbound_campaign')).toBeInTheDocument()

    // Unrelated categories resolved by their own requests are unaffected.
    fireEvent.click(screen.getByRole('button', { name: /^Status\b/ }))
    expect(screen.getByText('Active')).toBeInTheDocument()
  })
})
