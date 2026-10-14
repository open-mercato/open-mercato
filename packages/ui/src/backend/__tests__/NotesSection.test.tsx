/** @jest-environment jsdom */

import * as React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { NotesSection, type NotesDataAdapter } from '../detail/NotesSection'
import { dismissRecordConflict, getRecordConflictForTest } from '../conflicts'
import { OPTIMISTIC_LOCK_CONFLICT_CODE } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

const createDataAdapter = (): NotesDataAdapter => ({
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
})

const baseProps = (dataAdapter: NotesDataAdapter) => ({
  entityId: 'person-1',
  emptyLabel: '—',
  viewerUserId: 'user-1',
  viewerName: 'Ada Lovelace',
  addActionLabel: 'Add note',
  emptyState: {
    title: 'No notes yet',
    actionLabel: 'Add note',
  },
  dataAdapter,
})

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

  it('renders the markdown toggle and appearance controls by default', async () => {
    const { container } = renderWithProviders(<NotesSection {...baseProps(createDataAdapter())} />)

    await screen.findByText('Existing note')
    expect(container.querySelectorAll('svg.lucide-palette').length).toBe(1)

    fireEvent.click(screen.getByRole('button', { name: 'Add note' }))

    await waitFor(() => {
      expect(container.querySelector('button[aria-pressed]')).not.toBeNull()
    })
    expect(screen.getByRole('button', { name: 'Customize appearance' })).toBeTruthy()
    expect(screen.queryByTestId('markdown-field')).toBeNull()
  })

  it('keeps the rich editor active and hides the toggle when forceMarkdown is set', async () => {
    const { container } = renderWithProviders(
      <NotesSection {...baseProps(createDataAdapter())} forceMarkdown />,
    )

    await screen.findByText('Existing note')
    fireEvent.click(screen.getByRole('button', { name: 'Add note' }))

    await waitFor(() => {
      expect(screen.getByTestId('markdown-field')).toBeTruthy()
    })
    expect(container.querySelector('button[aria-pressed]')).toBeNull()
  })

  it('hides the toggle but honors the seeded preference when hideMarkdownToggle is set', async () => {
    const { container } = renderWithProviders(
      <NotesSection
        {...baseProps(createDataAdapter())}
        hideMarkdownToggle
        readMarkdownPreference={() => true}
      />,
    )

    await screen.findByText('Existing note')
    fireEvent.click(screen.getByRole('button', { name: 'Add note' }))

    await waitFor(() => {
      expect(screen.getByTestId('markdown-field')).toBeTruthy()
    })
    expect(container.querySelector('button[aria-pressed]')).toBeNull()
  })

  it('removes every appearance affordance when disableAppearance is set', async () => {
    const { container } = renderWithProviders(
      <NotesSection {...baseProps(createDataAdapter())} disableAppearance />,
    )

    await screen.findByText('Existing note')
    fireEvent.click(screen.getByRole('button', { name: 'Add note' }))

    await waitFor(() => {
      expect(container.querySelector('button[aria-pressed]')).not.toBeNull()
    })
    expect(screen.queryByRole('button', { name: 'Customize appearance' })).toBeNull()
    expect(container.querySelectorAll('svg.lucide-palette').length).toBe(0)
  })

  describe('host options', () => {
    const twoNotesAdapter = (): NotesDataAdapter => ({
      list: jest.fn(async () => [
        {
          id: 'note-own',
          body: 'Own note',
          createdAt: '2026-04-10T08:00:00.000Z',
          authorUserId: 'user-1',
        },
        {
          id: 'note-other',
          body: 'Other note',
          createdAt: '2026-04-09T08:00:00.000Z',
          authorUserId: 'user-2',
          authorName: 'Grace Hopper',
        },
      ]),
      create: jest.fn(async () => ({ id: 'note-new' })),
      update: jest.fn(async () => undefined),
      delete: jest.fn(async () => undefined),
    })

    const noteCard = (text: string) => {
      const card = screen.getByText(text).closest('.group')
      if (!(card instanceof HTMLElement)) throw new Error(`card for ${text} not found`)
      return card
    }

    it('renders edit, appearance and delete controls on every note by default', async () => {
      renderWithProviders(<NotesSection {...baseProps(twoNotesAdapter())} />)

      await screen.findByText('Other note')
      for (const text of ['Own note', 'Other note']) {
        const card = noteCard(text)
        expect(card.querySelector('svg.lucide-pencil')).not.toBeNull()
        expect(card.querySelector('svg.lucide-palette')).not.toBeNull()
        expect(card.querySelector('svg.lucide-trash2, svg.lucide-trash-2')).not.toBeNull()
        expect(card.querySelector('[role="button"]')).not.toBeNull()
      }
    })

    it('hides per-note edit controls and click-to-edit when canEditNote returns false', async () => {
      const { container } = renderWithProviders(
        <NotesSection
          {...baseProps(twoNotesAdapter())}
          disableMarkdown
          canEditNote={(note) => note.authorUserId === 'user-1'}
        />,
      )

      await screen.findByText('Other note')
      const own = noteCard('Own note')
      const other = noteCard('Other note')
      expect(own.querySelector('svg.lucide-pencil')).not.toBeNull()
      expect(own.querySelector('svg.lucide-palette')).not.toBeNull()
      expect(other.querySelector('svg.lucide-pencil')).toBeNull()
      expect(other.querySelector('svg.lucide-palette')).toBeNull()
      expect(other.querySelector('svg.lucide-trash2, svg.lucide-trash-2')).not.toBeNull()
      expect(other.querySelector('[role="button"]')).toBeNull()

      fireEvent.click(screen.getByText('Other note'))
      expect(container.querySelector('textarea')).toBeNull()
    })

    it('hides the per-note delete control when canDeleteNote returns false', async () => {
      renderWithProviders(
        <NotesSection
          {...baseProps(twoNotesAdapter())}
          canDeleteNote={(note) => note.authorUserId === 'user-1'}
        />,
      )

      await screen.findByText('Other note')
      expect(noteCard('Own note').querySelector('svg.lucide-trash2, svg.lucide-trash-2')).not.toBeNull()
      const other = noteCard('Other note')
      expect(other.querySelector('svg.lucide-trash2, svg.lucide-trash-2')).toBeNull()
      expect(other.querySelector('svg.lucide-pencil')).not.toBeNull()
    })

    it('hides the composer, add actions and every mutation control in readOnly mode', async () => {
      const onActionChange = jest.fn()
      const { container } = renderWithProviders(
        <NotesSection {...baseProps(twoNotesAdapter())} readOnly onActionChange={onActionChange} />,
      )

      await screen.findByText('Other note')
      expect(screen.getByText('Own note')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Add note' })).toBeNull()
      expect(container.querySelector('svg.lucide-pencil')).toBeNull()
      expect(container.querySelector('svg.lucide-palette')).toBeNull()
      expect(container.querySelector('svg.lucide-trash2, svg.lucide-trash-2')).toBeNull()
      expect(container.querySelector('[role="button"]')).toBeNull()
      expect(container.querySelector('form')).toBeNull()
      expect(onActionChange).not.toHaveBeenCalledWith(expect.objectContaining({ label: 'Add note' }))

      fireEvent.click(screen.getByText('Own note'))
      expect(container.querySelector('textarea')).toBeNull()
    })

    it('renders the empty state without an add action in readOnly mode', async () => {
      const dataAdapter: NotesDataAdapter = { ...createDataAdapter(), list: jest.fn(async () => []) }
      renderWithProviders(<NotesSection {...baseProps(dataAdapter)} readOnly />)

      expect(await screen.findByText('No notes yet')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Add note' })).toBeNull()
    })

    it('renders the generic note context as a link or plain text', async () => {
      const dataAdapter: NotesDataAdapter = {
        ...createDataAdapter(),
        list: jest.fn(async () => [
          {
            id: 'note-linked',
            body: 'Linked note',
            createdAt: '2026-04-10T08:00:00.000Z',
            contextLabel: 'Order #1001',
            contextHref: '/backend/sales/orders/order-1001',
          },
          {
            id: 'note-plain',
            body: 'Plain note',
            createdAt: '2026-04-09T08:00:00.000Z',
            contextLabel: 'Warehouse A',
          },
        ]),
      }
      renderWithProviders(<NotesSection {...baseProps(dataAdapter)} />)

      await screen.findByText('Plain note')
      expect(screen.getByRole('link', { name: 'Order #1001' })).toHaveAttribute(
        'href',
        '/backend/sales/orders/order-1001',
      )
      const plain = screen.getByText('Warehouse A')
      expect(plain.closest('a')).toBeNull()
    })
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
