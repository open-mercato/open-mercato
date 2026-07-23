/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import {
  DictionaryEntrySelect,
  DictionaryOptionsUnavailableError,
  type DictionarySelectLabels,
} from '../DictionaryEntrySelect'
import { flash } from '@open-mercato/ui/backend/FlashMessages'

jest.mock('next/navigation', () => ({
  usePathname: () => '/backend/customers',
  useSearchParams: () => new URLSearchParams(),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

jest.mock('@open-mercato/ui/primitives/button', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}))

jest.mock('@open-mercato/ui/primitives/input', () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}))

jest.mock('@open-mercato/ui/primitives/dialog', () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

jest.mock('@open-mercato/ui/primitives/select', () => ({
  Select: ({ children, value, onValueChange }: {
    children: React.ReactNode
    value?: string
    onValueChange?: (value: string) => void
  }) => (
    <select
      data-testid="dictionary-entry-select"
      value={value ?? ''}
      onChange={(event) => onValueChange?.(event.currentTarget.value)}
    >
      {children}
    </select>
  ),
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ children, value }: { children: React.ReactNode; value: string }) => (
    <option value={value}>{children}</option>
  ),
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectValue: () => null,
}))

const labels: DictionarySelectLabels = {
  placeholder: 'Select value',
  addLabel: 'Add',
  dialogTitle: 'Add value',
  valueLabel: 'Value',
  valuePlaceholder: 'Value',
  labelLabel: 'Label',
  labelPlaceholder: 'Label',
  emptyError: 'Required',
  cancelLabel: 'Cancel',
  saveLabel: 'Save',
  errorLoad: 'Load failed',
  errorSave: 'Save failed',
  loadingLabel: 'Loading',
  manageTitle: 'Manage',
}

const fetchOptions = jest.fn(async () => [
  { value: 'b', label: 'Beta', color: null, icon: null },
  { value: 'a', label: 'Alpha', color: null, icon: null },
])

function optionLabels() {
  return Array.from(screen.getByTestId('dictionary-entry-select').querySelectorAll('option'))
    .map((option) => option.textContent)
}

describe('DictionaryEntrySelect', () => {
  beforeEach(() => {
    fetchOptions.mockClear()
    ;(flash as jest.Mock).mockClear()
  })

  it('keeps API order when sortOptions is none', async () => {
    render(
      <DictionaryEntrySelect
        value={undefined}
        onChange={jest.fn()}
        fetchOptions={fetchOptions}
        labels={labels}
        allowInlineCreate={false}
        showManage={false}
        sortOptions="none"
      />,
    )

    await waitFor(() => expect(optionLabels()).toEqual(['Beta', 'Alpha']))
  })

  it('keeps existing label ascending default', async () => {
    render(
      <DictionaryEntrySelect
        value={undefined}
        onChange={jest.fn()}
        fetchOptions={fetchOptions}
        labels={labels}
        allowInlineCreate={false}
        showManage={false}
      />,
    )

    await waitFor(() => expect(optionLabels()).toEqual(['Alpha', 'Beta']))
  })

  it('keeps the selected value visible when it is missing from fetched options', async () => {
    render(
      <DictionaryEntrySelect
        value="legacy"
        onChange={jest.fn()}
        fetchOptions={fetchOptions}
        labels={labels}
        allowInlineCreate={false}
        showManage={false}
      />,
    )

    await waitFor(() => expect(optionLabels()).toEqual(['legacy', 'Alpha', 'Beta']))
  })

  it('shows an inline hint instead of an error toast when options are unavailable (#4401)', async () => {
    const unavailableFetch = jest.fn(async () => {
      throw new DictionaryOptionsUnavailableError('Organization context is required')
    })

    render(
      <DictionaryEntrySelect
        value={undefined}
        onChange={jest.fn()}
        fetchOptions={unavailableFetch}
        labels={labels}
        allowInlineCreate={false}
        showManage={false}
      />,
    )

    await waitFor(() =>
      expect(screen.getByText('Organization context is required')).toBeInTheDocument(),
    )
    expect(flash).not.toHaveBeenCalled()
    expect(optionLabels()).toEqual([])
  })

  it('still flashes the load error for unexpected failures', async () => {
    const failingFetch = jest.fn(async () => {
      throw new Error('boom')
    })

    render(
      <DictionaryEntrySelect
        value={undefined}
        onChange={jest.fn()}
        fetchOptions={failingFetch}
        labels={labels}
        allowInlineCreate={false}
        showManage={false}
      />,
    )

    await waitFor(() => expect(flash).toHaveBeenCalledWith('Load failed', 'error'))
    expect(screen.queryByText('boom')).toBeNull()
  })
})
