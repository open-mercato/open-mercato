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
