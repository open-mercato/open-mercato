/** @jest-environment jsdom */

import * as React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { NotesSection, type NotesDataAdapter } from '../detail/NotesSection'
import { dismissRecordConflict, getRecordConflictForTest } from '../conflicts'
import { OPTIMISTIC_LOCK_CONFLICT_CODE } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

describe('NotesSection', () => {
  beforeEach(() => {
    dismissRecordConflict()
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      writable: true,
      value: jest.fn(),
    })
    Object.defineProperty(window, 'requestAnimationFrame', {
      configurable: true,
      writable: true,
      value: (callback: FrameRequestCallback) => {
        callback(0)
        return 0
      },
    })
  })

  afterEach(() => {
    dismissRecordConflict()
  })

  // In paged mode the guard used to be `currentPage >= totalPages`. A
  // `totalPages` derived from an under-reporting total — a capped list count, or
  // notes added between requests — hid the button and left the rest unreachable.
  // `/api/customers/comments` is a `makeCrudRoute` list, so a page past the end
  // comes back empty rather than clamped, and that is what ends the sequence.
  describe('paged load-more termination', () => {
    const PAGE_SIZE = 20

    const makeNotes = (count: number, offset = 0) =>
      Array.from({ length: count }, (_, index) => ({
        id: `note-${offset + index + 1}`,
        body: `Note ${offset + index + 1}`,
        createdAt: '2026-04-10T08:00:00.000Z',
        authorName: 'Ada Lovelace',
      }))

    const translator = (key: string, fallback?: string) =>
      key === 'customers.people.detail.notes.loadMore' ? 'Load more' : fallback ?? key

    const renderPaged = (listPage: jest.Mock) =>
      renderWithProviders(
        <NotesSection
          entityId="person-1"
          emptyLabel="—"
          viewerUserId="user-1"
          viewerName="Ada Lovelace"
          addActionLabel="Add note"
          emptyState={{ title: 'No notes yet', actionLabel: 'Add note' }}
          dataAdapter={{
            list: jest.fn(async () => []),
            listPage,
            create: jest.fn(async () => ({ id: 'note-new' })),
            update: jest.fn(async () => undefined),
            delete: jest.fn(async () => undefined),
          } as NotesDataAdapter}
          translator={translator}
          disableMarkdown
        />,
      )

    it('offers Load more on a full page even when totalPages reports a single page', async () => {
      const listPage = jest.fn(async () => ({
        items: makeNotes(PAGE_SIZE),
        total: 3,
        page: 1,
        pageSize: PAGE_SIZE,
        totalPages: 1,
      }))

      renderPaged(listPage)

      expect(await screen.findByText('Note 1')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Load more' })).toBeInTheDocument()
    })

    it('hides Load more once a page comes back short', async () => {
      const listPage = jest.fn(async () => ({
        items: makeNotes(3),
        // A large total must not conjure a next page.
        total: 999,
        page: 1,
        pageSize: PAGE_SIZE,
        totalPages: 50,
      }))

      renderPaged(listPage)

      expect(await screen.findByText('Note 1')).toBeInTheDocument()
      await waitFor(() => {
        expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull()
      })
    })

    it('stops on the empty page past the end without duplicating rows', async () => {
      const listPage = jest
        .fn()
        .mockResolvedValueOnce({
          items: makeNotes(PAGE_SIZE),
          total: PAGE_SIZE,
          page: 1,
          pageSize: PAGE_SIZE,
          totalPages: 1,
        })
        .mockResolvedValueOnce({
          items: [],
          total: PAGE_SIZE,
          page: 2,
          pageSize: PAGE_SIZE,
          totalPages: 1,
        })

      renderPaged(listPage)

      fireEvent.click(await screen.findByRole('button', { name: 'Load more' }))

      await waitFor(() => {
        expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull()
      })
      expect(listPage).toHaveBeenCalledTimes(2)
      expect(screen.getAllByText('Note 20')).toHaveLength(1)
    })
  })

  it('keeps an add-note action visible after notes already exist', async () => {
    const dataAdapter: NotesDataAdapter = {
      list: jest.fn(async () => [
        {
          id: 'note-1',
          body: 'Existing note',
          createdAt: '2026-04-10T08:00:00.000Z',
          authorName: 'Ada Lovelace',
        },
      ]),
      create: jest.fn(async () => ({ id: 'note-2' })),
      update: jest.fn(async () => undefined),
      delete: jest.fn(async () => undefined),
    }

    const { container } = renderWithProviders(
      <NotesSection
        entityId="person-1"
        emptyLabel="—"
        viewerUserId="user-1"
        viewerName="Ada Lovelace"
        addActionLabel="Add note"
        emptyState={{
          title: 'No notes yet',
          actionLabel: 'Add note',
        }}
        dataAdapter={dataAdapter}
        disableMarkdown
      />,
    )

    await screen.findByText('Existing note')
    fireEvent.click(screen.getByRole('button', { name: 'Add note' }))

    await waitFor(() => {
      expect(container.querySelector('textarea')).not.toBeNull()
    })
  })

  it('sends the selected concrete entityId when rendered with the deal page prop shape', async () => {
    const dataAdapter: NotesDataAdapter = {
      list: jest.fn(async () => [
        {
          id: 'note-1',
          body: 'Existing note',
          createdAt: '2026-04-10T08:00:00.000Z',
          authorName: 'Ada Lovelace',
        },
      ]),
      create: jest.fn(async () => ({ id: 'note-2' })),
      update: jest.fn(async () => undefined),
      delete: jest.fn(async () => undefined),
    }

    const { container } = renderWithProviders(
      <NotesSection
        entityId={null}
        dealId="deal-1"
        entityOptions={[
          { id: 'person-1', label: 'Ada Lovelace' },
          { id: 'company-1', label: 'Acme Corp' },
        ]}
        emptyLabel="—"
        viewerUserId="user-1"
        viewerName="Ada Lovelace"
        addActionLabel="Add note"
        emptyState={{
          title: 'No notes yet',
          actionLabel: 'Add note',
        }}
        dataAdapter={dataAdapter}
        disableMarkdown
      />,
    )

    await screen.findByText('Existing note')
    fireEvent.click(screen.getByRole('button', { name: 'Add note' }))

    const textarea = await waitFor(() => {
      const el = container.querySelector('textarea')
      if (!el) throw new Error('composer not open')
      return el as HTMLTextAreaElement
    })
    fireEvent.change(textarea, { target: { value: 'Deal note' } })

    const form = container.querySelector('form')
    expect(form).not.toBeNull()
    fireEvent.submit(form as HTMLFormElement)

    await waitFor(() => {
      expect(dataAdapter.create).toHaveBeenCalledTimes(1)
    })
    const createInput = (dataAdapter.create as jest.Mock).mock.calls[0][0]
    expect(createInput.entityId).toBe('person-1')
    expect(createInput.dealId).toBe('deal-1')
  })

  it('disables the add action and never creates when the deal has no entity options', async () => {
    const dataAdapter: NotesDataAdapter = {
      list: jest.fn(async () => [
        {
          id: 'note-1',
          body: 'Existing note',
          createdAt: '2026-04-10T08:00:00.000Z',
          authorName: 'Ada Lovelace',
        },
      ]),
      create: jest.fn(async () => ({ id: 'note-2' })),
      update: jest.fn(async () => undefined),
      delete: jest.fn(async () => undefined),
    }

    const { container } = renderWithProviders(
      <NotesSection
        entityId={null}
        dealId="deal-1"
        entityOptions={[]}
        emptyLabel="—"
        viewerUserId="user-1"
        viewerName="Ada Lovelace"
        addActionLabel="Add note"
        emptyState={{
          title: 'No notes yet',
          actionLabel: 'Add note',
        }}
        dataAdapter={dataAdapter}
        disableMarkdown
      />,
    )

    await screen.findByText('Existing note')
    const addButton = screen.getByRole('button', { name: 'Add note' })
    expect(addButton).toBeDisabled()
    fireEvent.click(addButton)

    expect(container.querySelector('textarea')).toBeNull()
    expect(dataAdapter.create).not.toHaveBeenCalled()
  })

  it('surfaces the unified conflict bar when a write fails with a 409', async () => {
    const conflict = {
      status: 409,
      body: {
        error: 'optimistic_lock_conflict',
        code: OPTIMISTIC_LOCK_CONFLICT_CODE,
        currentUpdatedAt: '2026-06-02T00:00:00.000Z',
        expectedUpdatedAt: '2026-06-01T00:00:00.000Z',
      },
    }
    const dataAdapter: NotesDataAdapter = {
      list: jest.fn(async () => [
        {
          id: 'note-1',
          body: 'Existing note',
          createdAt: '2026-04-10T08:00:00.000Z',
          authorName: 'Ada Lovelace',
        },
      ]),
      create: jest.fn(async () => {
        throw conflict
      }),
      update: jest.fn(async () => undefined),
      delete: jest.fn(async () => undefined),
    }

    const { container } = renderWithProviders(
      <NotesSection
        entityId="person-1"
        emptyLabel="—"
        viewerUserId="user-1"
        viewerName="Ada Lovelace"
        addActionLabel="Add note"
        emptyState={{
          title: 'No notes yet',
          actionLabel: 'Add note',
        }}
        dataAdapter={dataAdapter}
        disableMarkdown
      />,
    )

    await screen.findByText('Existing note')
    fireEvent.click(screen.getByRole('button', { name: 'Add note' }))

    const textarea = await waitFor(() => {
      const el = container.querySelector('textarea')
      if (!el) throw new Error('composer not open')
      return el as HTMLTextAreaElement
    })
    fireEvent.change(textarea, { target: { value: 'Conflicting note' } })

    const form = container.querySelector('form')
    expect(form).not.toBeNull()
    fireEvent.submit(form as HTMLFormElement)

    await waitFor(() => {
      expect(dataAdapter.create).toHaveBeenCalledTimes(1)
      const entry = getRecordConflictForTest()
      expect(entry).not.toBeNull()
      expect(entry?.currentUpdatedAt).toBe('2026-06-02T00:00:00.000Z')
    })
  })
})
