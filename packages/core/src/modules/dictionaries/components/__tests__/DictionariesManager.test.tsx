/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { DictionariesManager } from '../DictionariesManager'

const apiCall = jest.fn()

jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/backend/dictionaries',
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCall(...args),
  withScopedApiRequestHeaders: (_header: unknown, fn: () => unknown) => fn(),
}))

jest.mock('@open-mercato/ui/backend/utils/optimisticLock', () => ({
  buildOptimisticLockHeader: () => ({}),
}))

jest.mock('@open-mercato/ui/backend/conflicts', () => ({
  surfaceRecordConflict: () => false,
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({ confirm: jest.fn(async () => false), ConfirmDialogElement: null }),
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => {
  const translate = (key: string, fallback?: unknown) =>
    typeof fallback === 'string' ? fallback : key
  return { useT: () => translate }
})

jest.mock('@open-mercato/ui/primitives/empty-state', () => ({
  EmptyState: ({ title }: { title?: React.ReactNode }) => <div>{title}</div>,
}))

jest.mock('@open-mercato/ui/primitives/button', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}))

jest.mock('@open-mercato/ui/primitives/spinner', () => ({
  Spinner: () => <span data-testid="spinner" />,
}))

jest.mock('@open-mercato/ui/primitives/dialog', () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}))

jest.mock('@open-mercato/ui/primitives/select', () => ({
  Select: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectValue: () => null,
}))

jest.mock('../DictionaryEntriesEditor', () => ({
  DictionaryEntriesEditor: ({ dictionaryId }: { dictionaryId: string }) => (
    <div data-testid="entries-editor">{dictionaryId}</div>
  ),
}))

const dictionaries = [
  {
    id: 'dict-colors',
    key: 'colors',
    name: 'Colors',
    description: null,
    isSystem: false,
    isActive: true,
    entrySortMode: 'label_asc',
    organizationId: 'org-1',
    isInherited: false,
    managerVisibility: 'default',
    updatedAt: '2026-06-18T00:00:00.000Z',
  },
  {
    id: 'dict-sizes',
    key: 'sizes',
    name: 'Sizes',
    description: null,
    isSystem: false,
    isActive: true,
    entrySortMode: 'label_asc',
    organizationId: 'org-1',
    isInherited: false,
    managerVisibility: 'default',
    updatedAt: '2026-06-18T00:00:00.000Z',
  },
]

function listFetchCount() {
  return apiCall.mock.calls.filter(([url]) => url === '/api/dictionaries').length
}

describe('DictionariesManager', () => {
  beforeEach(() => {
    apiCall.mockReset()
    apiCall.mockImplementation(async (url: string) => {
      if (url === '/api/dictionaries') {
        return { ok: true, result: { items: dictionaries } }
      }
      return { ok: true, result: {} }
    })
  })

  it('does not refetch the dictionaries list when the selection changes', async () => {
    render(<DictionariesManager />)

    // Initial load auto-selects the first dictionary and fetches the list exactly once.
    await waitFor(() => expect(screen.getByTestId('entries-editor')).toHaveTextContent('dict-colors'))
    expect(listFetchCount()).toBe(1)

    // Selecting another dictionary must update the editor without refetching the list.
    fireEvent.click(screen.getByText('Sizes'))
    await waitFor(() => expect(screen.getByTestId('entries-editor')).toHaveTextContent('dict-sizes'))
    expect(listFetchCount()).toBe(1)
  })

  function createRequests() {
    return apiCall.mock.calls.filter(
      ([url, init]) => url === '/api/dictionaries' && (init as RequestInit | undefined)?.method === 'POST',
    )
  }

  async function openCreateDialogWithValues() {
    render(<DictionariesManager />)
    await waitFor(() => expect(screen.getByTestId('entries-editor')).toHaveTextContent('dict-colors'))
    fireEvent.click(screen.getByText('New dictionary'))
    fireEvent.change(screen.getByPlaceholderText('slug_name'), { target: { value: 'qa.test.dictionary' } })
    const nameInput = screen.getByPlaceholderText('Display name')
    fireEvent.change(nameInput, { target: { value: 'QA test' } })
    return nameInput
  }

  it.each([
    ['Ctrl+Enter', { ctrlKey: true }],
    ['Cmd+Enter', { metaKey: true }],
  ])('creates the dictionary when %s is pressed inside the dialog', async (_label, modifier) => {
    const nameInput = await openCreateDialogWithValues()

    fireEvent.keyDown(nameInput, { key: 'Enter', ...modifier })

    await waitFor(() => expect(createRequests()).toHaveLength(1))
    expect(JSON.parse(String((createRequests()[0][1] as RequestInit).body))).toMatchObject({
      key: 'qa.test.dictionary',
      name: 'QA test',
    })
  })

  it('does not submit the dialog on a plain Enter', async () => {
    const nameInput = await openCreateDialogWithValues()

    fireEvent.keyDown(nameInput, { key: 'Enter' })

    expect(createRequests()).toHaveLength(0)
  })
})
