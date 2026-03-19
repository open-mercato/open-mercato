/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { PriceKindSettings } from '../PriceKindSettings'

const mockApiCall = jest.fn()
const mockReadApiResultOrThrow = jest.fn()
const mockRaiseCrudError = jest.fn()
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => mockApiCall(...args),
  readApiResultOrThrow: (...args: unknown[]) => mockReadApiResultOrThrow(...args),
}))
jest.mock('@open-mercato/ui/backend/utils/serverErrors', () => ({
  raiseCrudError: (...args: unknown[]) => mockRaiseCrudError(...args),
}))

const mockFlash = jest.fn()
jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: (...args: unknown[]) => mockFlash(...args),
}))

const mockConfirm = jest.fn()
jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({
    confirm: (...args: unknown[]) => mockConfirm(...args),
    ConfirmDialogElement: null,
  }),
}))

jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({
  useOrganizationScopeVersion: () => 1,
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => {
  const translate = (key: string, fallback?: string, vars?: Record<string, unknown>) => {
    const base = (fallback ?? key) as string
    if (vars) return base.replace(/\{\{(\w+)\}\}/g, (_, token: string) => String(vars[token] ?? ''))
    return base
  }
  return { useT: () => translate }
})

jest.mock('@open-mercato/ui/primitives/button', () => ({
  Button: ({ children, asChild, ...props }: any) => (
    <button {...props} type={props.type || 'button'}>{children}</button>
  ),
}))
jest.mock('@open-mercato/ui/primitives/input', () => ({
  Input: ({ children, ...props }: any) => <input {...props}>{children}</input>,
}))
jest.mock('@open-mercato/ui/primitives/label', () => ({
  Label: ({ children, ...props }: any) => <label {...props}>{children}</label>,
}))
jest.mock('@open-mercato/ui/primitives/dialog', () => ({
  Dialog: ({ children, open }: any) => (open ? <div data-testid="dialog">{children}</div> : null),
  DialogContent: ({ children }: any) => <div data-testid="dialog-content">{children}</div>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <h3 data-testid="dialog-title">{children}</h3>,
  DialogDescription: ({ children }: any) => <p>{children}</p>,
  DialogFooter: ({ children }: any) => <div data-testid="dialog-footer">{children}</div>,
}))

jest.mock('@open-mercato/ui/backend/DataTable', () => ({
  DataTable: ({ data = [], actions, isLoading, emptyState, searchValue, onSearchChange, searchPlaceholder, rowActions }: any) => (
    <div data-testid="data-table">
      {actions && <div data-testid="table-actions">{actions}</div>}
      {searchPlaceholder && (
        <input
          data-testid="search-input"
          placeholder={searchPlaceholder}
          value={searchValue ?? ''}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => onSearchChange?.(e.target.value)}
        />
      )}
      {isLoading && <div data-testid="loading">Loading...</div>}
      <div data-testid="data-count">{Array.isArray(data) ? data.length : 0}</div>
      {Array.isArray(data) && data.length === 0 && !isLoading && emptyState}
      {Array.isArray(data) && data.map((item: any) => (
        <div key={item.id} data-testid={`row-${item.id}`}>
          <span>{item.code}</span>
          <span>{item.title}</span>
          {rowActions && <div data-testid={`row-actions-${item.id}`}>{rowActions(item)}</div>}
        </div>
      ))}
    </div>
  ),
}))

jest.mock('@open-mercato/ui/backend/RowActions', () => ({
  RowActions: ({ items }: { items?: Array<{ id: string; label: string; onSelect?: () => void }> }) => (
    <div data-testid="row-actions">
      {items?.map((item) => (
        <button key={item.id} data-testid={`action-${item.id}`} type="button" onClick={item.onSelect}>
          {item.label}
        </button>
      ))}
    </div>
  ),
}))

jest.mock('@open-mercato/core/modules/dictionaries/components/DictionaryEntrySelect', () => ({
  DictionaryEntrySelect: ({ value, onChange }: any) => (
    <select
      data-testid="currency-select"
      value={value ?? ''}
      onChange={(e: React.ChangeEvent<HTMLSelectElement>) => onChange(e.target.value || undefined)}
    >
      <option value="">None</option>
      <option value="eur">EUR</option>
      <option value="usd">USD</option>
    </select>
  ),
}))

jest.mock('@open-mercato/core/modules/customers/components/detail/hooks/useCurrencyDictionary', () => ({
  useCurrencyDictionary: () => ({
    data: { entries: [{ value: 'eur', label: 'Euro', color: null, icon: null }] },
    refetch: jest.fn(),
  }),
}))

const sampleItems = [
  {
    id: 'pk-1',
    code: 'retail',
    title: 'Retail Price',
    displayMode: 'excluding-tax',
    currencyCode: 'eur',
    isPromotion: false,
    isActive: true,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
  },
  {
    id: 'pk-2',
    code: 'promo',
    title: 'Promo Price',
    displayMode: 'including-tax',
    currencyCode: null,
    isPromotion: true,
    isActive: false,
    createdAt: '2026-01-02',
    updatedAt: '2026-01-02',
  },
]

describe('PriceKindSettings', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockReadApiResultOrThrow.mockResolvedValue({ items: sampleItems })
  })

  it('renders the section title and description', async () => {
    render(<PriceKindSettings />)
    expect(screen.getByText('Price kinds')).toBeInTheDocument()
    expect(screen.getByText('Configure reusable price kinds that control pricing columns and tax display.')).toBeInTheDocument()
  })

  it('loads and displays price kind items on mount', async () => {
    render(<PriceKindSettings />)
    await waitFor(() => {
      expect(mockReadApiResultOrThrow).toHaveBeenCalledWith(
        '/api/catalog/price-kinds?pageSize=100',
        undefined,
        expect.objectContaining({ errorMessage: expect.any(String) }),
      )
    })
    await waitFor(() => {
      expect(screen.getByTestId('data-count')).toHaveTextContent('2')
    })
  })

  it('shows empty state when no items are loaded', async () => {
    mockReadApiResultOrThrow.mockResolvedValue({ items: [] })
    render(<PriceKindSettings />)
    await waitFor(() => {
      expect(screen.getByText('No price kinds yet.')).toBeInTheDocument()
    })
  })

  it('shows loading state while fetching', () => {
    mockReadApiResultOrThrow.mockReturnValue(new Promise(() => {}))
    render(<PriceKindSettings />)
    expect(screen.getByTestId('loading')).toBeInTheDocument()
  })

  it('opens create dialog when Add button is clicked', async () => {
    render(<PriceKindSettings />)
    await waitFor(() => {
      expect(screen.getByTestId('data-count')).toHaveTextContent('2')
    })
    fireEvent.click(screen.getByText('Add price kind'))
    expect(screen.getByTestId('dialog')).toBeInTheDocument()
    expect(screen.getByTestId('dialog-title')).toHaveTextContent('Create price kind')
  })

  it('opens edit dialog when Edit row action is clicked', async () => {
    render(<PriceKindSettings />)
    await waitFor(() => {
      expect(screen.getByTestId('data-count')).toHaveTextContent('2')
    })
    const editButtons = screen.getAllByTestId('action-edit')
    fireEvent.click(editButtons[0])
    expect(screen.getByTestId('dialog')).toBeInTheDocument()
    expect(screen.getByTestId('dialog-title')).toHaveTextContent('Edit price kind')
  })

  it('disables code input in edit mode', async () => {
    render(<PriceKindSettings />)
    await waitFor(() => {
      expect(screen.getByTestId('data-count')).toHaveTextContent('2')
    })
    const editButtons = screen.getAllByTestId('action-edit')
    fireEvent.click(editButtons[0])
    const codeInput = screen.getByPlaceholderText('e.g. regular')
    expect(codeInput).toBeDisabled()
  })

  it('populates form with entry values in edit mode', async () => {
    render(<PriceKindSettings />)
    await waitFor(() => {
      expect(screen.getByTestId('data-count')).toHaveTextContent('2')
    })
    const editButtons = screen.getAllByTestId('action-edit')
    fireEvent.click(editButtons[0])
    expect((screen.getByPlaceholderText('e.g. regular') as HTMLInputElement).value).toBe('retail')
    expect((screen.getByPlaceholderText('e.g. Regular price') as HTMLInputElement).value).toBe('Retail Price')
  })

  it('shows validation error when code or title is empty on submit', async () => {
    render(<PriceKindSettings />)
    await waitFor(() => {
      expect(screen.getByTestId('data-count')).toHaveTextContent('2')
    })
    fireEvent.click(screen.getByText('Add price kind'))
    fireEvent.click(screen.getByText('Create'))
    await waitFor(() => {
      expect(screen.getByText('Code and title are required.')).toBeInTheDocument()
    })
  })

  it('submits create form with POST and reloads items', async () => {
    mockApiCall.mockResolvedValue({ ok: true, result: { ok: true } })
    render(<PriceKindSettings />)
    await waitFor(() => {
      expect(screen.getByTestId('data-count')).toHaveTextContent('2')
    })
    fireEvent.click(screen.getByText('Add price kind'))
    fireEvent.change(screen.getByPlaceholderText('e.g. regular'), { target: { value: 'wholesale' } })
    fireEvent.change(screen.getByPlaceholderText('e.g. Regular price'), { target: { value: 'Wholesale Price' } })
    fireEvent.click(screen.getByText('Create'))
    await waitFor(() => {
      expect(mockApiCall).toHaveBeenCalledWith(
        '/api/catalog/price-kinds',
        expect.objectContaining({ method: 'POST' }),
      )
    })
    await waitFor(() => {
      expect(mockFlash).toHaveBeenCalledWith('Price kind created.', 'success')
    })
  })

  it('submits edit form with PUT', async () => {
    mockApiCall.mockResolvedValue({ ok: true, result: { ok: true } })
    render(<PriceKindSettings />)
    await waitFor(() => {
      expect(screen.getByTestId('data-count')).toHaveTextContent('2')
    })
    const editButtons = screen.getAllByTestId('action-edit')
    fireEvent.click(editButtons[0])
    fireEvent.change(screen.getByPlaceholderText('e.g. Regular price'), { target: { value: 'Updated Title' } })
    fireEvent.click(screen.getByText('Save changes'))
    await waitFor(() => {
      expect(mockApiCall).toHaveBeenCalledWith(
        '/api/catalog/price-kinds',
        expect.objectContaining({ method: 'PUT' }),
      )
    })
  })

  it('calls delete API after confirmation', async () => {
    mockConfirm.mockResolvedValue(true)
    mockApiCall.mockResolvedValue({ ok: true, result: { ok: true } })
    render(<PriceKindSettings />)
    await waitFor(() => {
      expect(screen.getByTestId('data-count')).toHaveTextContent('2')
    })
    const deleteButtons = screen.getAllByTestId('action-delete')
    fireEvent.click(deleteButtons[0])
    await waitFor(() => {
      expect(mockConfirm).toHaveBeenCalledWith(
        expect.objectContaining({ variant: 'destructive' }),
      )
    })
    await waitFor(() => {
      expect(mockApiCall).toHaveBeenCalledWith(
        '/api/catalog/price-kinds',
        expect.objectContaining({
          method: 'DELETE',
          body: JSON.stringify({ id: 'pk-1' }),
        }),
      )
    })
    await waitFor(() => {
      expect(mockFlash).toHaveBeenCalledWith('Price kind deleted.', 'success')
    })
  })

  it('does not delete when confirmation is cancelled', async () => {
    mockConfirm.mockResolvedValue(false)
    render(<PriceKindSettings />)
    await waitFor(() => {
      expect(screen.getByTestId('data-count')).toHaveTextContent('2')
    })
    const deleteButtons = screen.getAllByTestId('action-delete')
    fireEvent.click(deleteButtons[0])
    await waitFor(() => {
      expect(mockConfirm).toHaveBeenCalled()
    })
    expect(mockApiCall).not.toHaveBeenCalledWith(
      '/api/catalog/price-kinds',
      expect.objectContaining({ method: 'DELETE' }),
    )
  })

  it('handles Cmd+Enter keyboard shortcut to submit the form', async () => {
    mockApiCall.mockResolvedValue({ ok: true, result: { ok: true } })
    render(<PriceKindSettings />)
    await waitFor(() => {
      expect(screen.getByTestId('data-count')).toHaveTextContent('2')
    })
    fireEvent.click(screen.getByText('Add price kind'))
    fireEvent.change(screen.getByPlaceholderText('e.g. regular'), { target: { value: 'special' } })
    fireEvent.change(screen.getByPlaceholderText('e.g. Regular price'), { target: { value: 'Special Price' } })
    const form = screen.getByTestId('dialog-content').querySelector('form')!
    fireEvent.keyDown(form, { key: 'Enter', metaKey: true })
    await waitFor(() => {
      expect(mockApiCall).toHaveBeenCalledWith(
        '/api/catalog/price-kinds',
        expect.objectContaining({ method: 'POST' }),
      )
    })
  })

  it('renders display mode radio buttons', async () => {
    render(<PriceKindSettings />)
    await waitFor(() => {
      expect(screen.getByTestId('data-count')).toHaveTextContent('2')
    })
    fireEvent.click(screen.getByText('Add price kind'))
    expect(screen.getByText('Excluding tax')).toBeInTheDocument()
    expect(screen.getByText('Including tax')).toBeInTheDocument()
  })

  it('flashes error when API load fails', async () => {
    mockReadApiResultOrThrow.mockRejectedValue(new Error('Network error'))
    render(<PriceKindSettings />)
    await waitFor(() => {
      expect(mockFlash).toHaveBeenCalledWith('Failed to load price kinds.', 'error')
    })
  })
})
