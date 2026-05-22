/** @jest-environment jsdom */

import * as React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { NotesSection, type NotesDataAdapter } from '../detail/NotesSection'

describe('NotesSection', () => {
  beforeEach(() => {
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
})
