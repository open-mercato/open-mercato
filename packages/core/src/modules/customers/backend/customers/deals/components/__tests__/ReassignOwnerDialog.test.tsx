/** @jest-environment jsdom */

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (_key: string, fallback?: string) => fallback ?? _key,
}))

// Mirrors the real helper's {placeholder} interpolation so count-bearing copy is assertable.
jest.mock('@open-mercato/shared/lib/i18n/translate', () => ({
  translateWithFallback: (
    _t: unknown,
    _key: string,
    fallback: string,
    params?: Record<string, string | number>,
  ) => String(fallback).replace(/\{(\w+)\}/g, (_match, name: string) => String(params?.[name] ?? `{${name}}`)),
}))

const fetchAssignableStaffMembers = jest.fn()
jest.mock('../../../../../lib/assignableStaff', () => ({
  fetchAssignableStaffMembers: (...args: unknown[]) => fetchAssignableStaffMembers(...args),
}))

import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ReassignOwnerDialog } from '../ReassignOwnerDialog'

const ROSTER = [
  { teamMemberId: 'tm-1', userId: 'user-9', displayName: 'Grace Hopper', email: 'grace@example.com', teamName: null },
]

function getSearchInput(): HTMLInputElement {
  const el = document.querySelector('input')
  if (!el) throw new Error('search input not found')
  return el as HTMLInputElement
}

function renderDialog(overrides: Partial<React.ComponentProps<typeof ReassignOwnerDialog>> = {}) {
  const props = {
    open: true,
    selectedCount: 3,
    isSubmitting: false,
    onClose: jest.fn(),
    onConfirm: jest.fn(),
    ...overrides,
  }
  render(<ReassignOwnerDialog {...props} />)
  return props
}

beforeEach(() => {
  fetchAssignableStaffMembers.mockReset()
  fetchAssignableStaffMembers.mockResolvedValue(ROSTER)
})

describe('ReassignOwnerDialog', () => {
  it('names the selected count so the operator sees the blast radius before confirming', () => {
    renderDialog({ selectedCount: 7 })
    expect(screen.getByText(/Reassign owner for 7 deals/i)).toBeTruthy()
  })

  it('keeps confirm disabled until a staff member is chosen', () => {
    renderDialog()
    const confirm = screen.getByRole('button', { name: /Reassign 3 deals/i }) as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
  })

  it('confirms with the chosen user id', async () => {
    const props = renderDialog()

    fireEvent.change(getSearchInput(), { target: { value: 'grace' } })
    await waitFor(() => expect(screen.getByText('Grace Hopper')).toBeTruthy())
    fireEvent.click(screen.getByText('Grace Hopper'))

    const confirm = screen.getByRole('button', { name: /Reassign 3 deals/i }) as HTMLButtonElement
    await waitFor(() => expect(confirm.disabled).toBe(false))
    fireEvent.click(confirm)

    expect(props.onConfirm).toHaveBeenCalledWith('user-9')
  })

  it('offers no way to confirm an empty owner, so a bulk unassignment cannot be sent', () => {
    const props = renderDialog()

    // Every rendered control is exercised; none may reach onConfirm without a selection.
    for (const button of screen.queryAllByRole('button')) fireEvent.click(button)

    expect(props.onConfirm).not.toHaveBeenCalled()
  })

  it('cancels without confirming', () => {
    const props = renderDialog()
    fireEvent.click(screen.getByRole('button', { name: /^Cancel$/i }))
    expect(props.onClose).toHaveBeenCalled()
    expect(props.onConfirm).not.toHaveBeenCalled()
  })

  it('submits on Cmd/Ctrl+Enter once an owner is chosen', async () => {
    const props = renderDialog()

    fireEvent.change(getSearchInput(), { target: { value: 'grace' } })
    await waitFor(() => expect(screen.getByText('Grace Hopper')).toBeTruthy())
    fireEvent.click(screen.getByText('Grace Hopper'))

    const dialog = screen.getByRole('dialog')
    fireEvent.keyDown(dialog, { key: 'Enter', metaKey: true })

    await waitFor(() => expect(props.onConfirm).toHaveBeenCalledWith('user-9'))
  })
})
