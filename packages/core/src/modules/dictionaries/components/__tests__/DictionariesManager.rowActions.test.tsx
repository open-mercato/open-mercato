/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
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
  const translate = (key: string, fallback?: unknown, params?: Record<string, unknown>) => {
    const template = typeof fallback === 'string' ? fallback : key
    const values = (typeof fallback === 'object' && fallback !== null ? fallback : params) as Record<string, unknown> | undefined
    return template.replace(/\{\{?(\w+)\}?\}/g, (match, name) => (values && name in values ? String(values[name]) : match))
  }
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
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
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

// Each dictionary row was a `div role="button"` that contained two icon
// buttons with no accessible name: an interactive control inside another, and
// 344 unnamed buttons on the settings page in the route sweep.
describe('DictionariesManager row actions', () => {
  beforeEach(() => {
    apiCall.mockReset()
    apiCall.mockImplementation(async (url: string) => {
      if (url === '/api/dictionaries') {
        return { ok: true, result: { items: dictionaries } }
      }
      return { ok: true, result: {} }
    })
  })

  async function renderList() {
    render(<DictionariesManager />)
    await waitFor(() => expect(screen.getByTestId('entries-editor')).toHaveTextContent('dict-colors'))
    return screen.getAllByRole('listitem')
  }

  it('names the edit and delete buttons after their dictionary', async () => {
    const rows = await renderList()

    expect(within(rows[0]).getByRole('button', { name: 'Edit Colors' })).toBeInTheDocument()
    expect(within(rows[0]).getByRole('button', { name: 'Delete Colors' })).toBeInTheDocument()
    expect(within(rows[1]).getByRole('button', { name: 'Edit Sizes' })).toBeInTheDocument()
    expect(within(rows[1]).getByRole('button', { name: 'Delete Sizes' })).toBeInTheDocument()
  })

  it('selects a dictionary with a button that holds no other control', async () => {
    const rows = await renderList()
    const select = within(rows[1]).getByRole('button', { name: /^Sizes/ })

    expect(select).toHaveAttribute('aria-pressed', 'false')
    expect(select.querySelector('button, a, [role="button"], [tabindex]')).toBeNull()
    expect(rows[1].querySelector('[role="button"] button, button button')).toBeNull()

    fireEvent.click(select)
    await waitFor(() => expect(screen.getByTestId('entries-editor')).toHaveTextContent('dict-sizes'))
    expect(within(rows[1]).getByRole('button', { name: /^Sizes/ })).toHaveAttribute('aria-pressed', 'true')
  })

  it('does not change the selection when an action button is used', async () => {
    const rows = await renderList()

    fireEvent.click(within(rows[1]).getByRole('button', { name: 'Edit Sizes' }))

    expect(screen.getByTestId('entries-editor')).toHaveTextContent('dict-colors')
  })
})
