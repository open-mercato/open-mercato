/** @jest-environment jsdom */

import * as React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'

jest.mock('@open-mercato/ui/primitives/dialog', () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DialogContent: ({ children, onKeyDown }: { children: React.ReactNode; onKeyDown?: React.KeyboardEventHandler<HTMLDivElement> }) => (
    <div role="dialog" tabIndex={-1} onKeyDown={onKeyDown}>{children}</div>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
}))

jest.mock('@open-mercato/ui/backend/CrudForm', () => ({
  CrudForm: ({ onSubmit }: { onSubmit: (values: Record<string, unknown>) => Promise<void> }) => (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        const form = event.currentTarget
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
        void onSubmit({ title: 'Follow up' }).catch(() => {
          form.closest<HTMLElement>('[role="dialog"]')?.focus()
        })
      }}
    >
      <input aria-label="Title" />
    </form>
  ),
}))

jest.mock('../hooks/useCustomerDictionary', () => ({
  useCustomerDictionary: () => ({ data: null }),
}))

import { TaskDialog } from '../TaskDialog'

describe('TaskDialog keyboard submission', () => {
  it('retries Ctrl+Enter after a rejected save moves focus to the dialog', async () => {
    const onSubmit = jest
      .fn<Promise<void>, []>()
      .mockRejectedValueOnce(new Error('Conflict'))
      .mockResolvedValueOnce(undefined)
    const onOpenChange = jest.fn()

    renderWithProviders(
      <TaskDialog
        open
        mode="edit"
        onOpenChange={onOpenChange}
        onSubmit={onSubmit}
        useCanonicalInteractions
      />,
    )

    const title = screen.getByRole('textbox', { name: 'Title' })
    title.focus()
    fireEvent.keyDown(title, { key: 'Enter', ctrlKey: true })

    const dialog = screen.getByRole('dialog')
    await waitFor(() => expect(dialog).toHaveFocus())
    fireEvent.keyDown(dialog, { key: 'Enter', ctrlKey: true })

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })
})
