/**
 * @jest-environment jsdom
 */

/**
 * The reassign dialog's own contract.
 *
 * Two things are asserted here rather than on the page: the project-wide dialog
 * keyboard rule (`Cmd/Ctrl+Enter` submits, `Escape` cancels — Radix owns the
 * latter, so what is testable here is that the dialog does not swallow it), and
 * that a body naming neither an assignee nor a queue never reaches the wire,
 * because `reassignUserTaskSchema` refuses it with a 400.
 */

import * as React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'

const mockTranslate = (key: string, fallback?: unknown) =>
  typeof fallback === 'string' ? fallback : key

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => mockTranslate,
}))

jest.mock('@open-mercato/ui/primitives/button', () => ({
  Button: ({
    children,
    ...rest
  }: { children?: React.ReactNode } & React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...rest}>{children}</button>
  ),
}))

// The form is a rail now, so the drawer primitive is what it renders through.
jest.mock('@open-mercato/ui/primitives/drawer', () => ({
  Drawer: ({ open, children }: { open?: boolean; children?: React.ReactNode }) =>
    open ? <div>{children}</div> : null,
  DrawerContent: ({
    children,
    closeAriaLabel: _closeAriaLabel,
    side: _side,
    hideCloseButton: _hideCloseButton,
    ...rest
  }: {
    children?: React.ReactNode
    closeAriaLabel?: string
    side?: string
    hideCloseButton?: boolean
  }) => <div {...rest}>{children}</div>,
  DrawerHeader: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  DrawerBody: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  DrawerFooter: ({ leading, children }: { leading?: React.ReactNode; children?: React.ReactNode }) => (
    <div>{leading}{children}</div>
  ),
  DrawerTitle: ({ children }: { children?: React.ReactNode }) => <h2>{children}</h2>,
  DrawerDescription: ({ children }: { children?: React.ReactNode }) => <p>{children}</p>,
  DrawerClose: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}))

jest.mock('@open-mercato/ui/primitives/input', () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}))

jest.mock('@open-mercato/ui/primitives/label', () => ({
  Label: ({ children, ...rest }: React.LabelHTMLAttributes<HTMLLabelElement>) => (
    <label {...rest}>{children}</label>
  ),
}))

jest.mock('@open-mercato/ui/primitives/textarea', () => ({
  Textarea: (props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...props} />,
}))

jest.mock('@open-mercato/ui/primitives/kbd', () => ({
  Kbd: ({ children }: { children?: React.ReactNode }) => <kbd>{children}</kbd>,
  KbdShortcut: ({ keys }: { keys: string[] }) => <kbd>{keys.join('+')}</kbd>,
}))

import { ReassignTaskDialog } from '../ReassignTaskDialog'

function renderDialog(overrides: Partial<React.ComponentProps<typeof ReassignTaskDialog>> = {}) {
  const onSubmit = jest.fn()
  const onOpenChange = jest.fn()
  render(
    <ReassignTaskDialog
      open
      submitting={false}
      onOpenChange={onOpenChange}
      onSubmit={onSubmit}
      {...overrides}
    />,
  )
  return { onSubmit, onOpenChange }
}

describe('ReassignTaskDialog', () => {
  test('Cmd/Ctrl+Enter submits', () => {
    const { onSubmit } = renderDialog()

    fireEvent.change(screen.getByTestId('task-reassign-assignee'), { target: { value: 'user-7' } })
    fireEvent.keyDown(screen.getByTestId('task-reassign-dialog'), { key: 'Enter', metaKey: true })

    expect(onSubmit).toHaveBeenCalledWith({
      assignedTo: 'user-7',
      assignedToRoles: null,
      reason: null,
    })

    fireEvent.keyDown(screen.getByTestId('task-reassign-dialog'), { key: 'Enter', ctrlKey: true })
    expect(onSubmit).toHaveBeenCalledTimes(2)
  })

  test('Escape is left to the dialog to cancel, never claimed as a submit', () => {
    const { onSubmit } = renderDialog()

    fireEvent.change(screen.getByTestId('task-reassign-assignee'), { target: { value: 'user-7' } })
    fireEvent.keyDown(screen.getByTestId('task-reassign-dialog'), { key: 'Escape' })

    expect(onSubmit).not.toHaveBeenCalled()
  })

  test('cancel closes without submitting', () => {
    const { onSubmit, onOpenChange } = renderDialog()

    fireEvent.click(screen.getByText('common.cancel'))

    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  test('refuses a target-less body locally, so the server never answers 400 for it', () => {
    const { onSubmit } = renderDialog()

    fireEvent.click(screen.getByTestId('task-reassign-submit'))

    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByTestId('task-reassign-target-required')).toBeTruthy()
  })

  test('trims and splits a comma-separated role queue', () => {
    const { onSubmit } = renderDialog()

    fireEvent.change(screen.getByTestId('task-reassign-roles'), {
      target: { value: ' approver ,, warehouse , ' },
    })
    fireEvent.change(screen.getByTestId('task-reassign-reason'), { target: { value: '  ' } })
    fireEvent.click(screen.getByTestId('task-reassign-submit'))

    expect(onSubmit).toHaveBeenCalledWith({
      assignedTo: null,
      assignedToRoles: ['approver', 'warehouse'],
      reason: null,
    })
  })
})
