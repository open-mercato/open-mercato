/**
 * @jest-environment jsdom
 */
import type React from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import CurrenciesPage from '../page'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'

const OPTIMISTIC_LOCK_HEADER = 'x-om-ext-optimistic-lock-expected-updated-at'

const mockTranslate = (key: string, fallback?: string) => fallback ?? key

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => mockTranslate,
}))

jest.mock('next/link', () => ({ children, href }: any) => <a href={href}>{children}</a>)

jest.mock('@open-mercato/ui/backend/Page', () => ({
  Page: ({ children }: any) => <div>{children}</div>,
  PageBody: ({ children }: any) => <div>{children}</div>,
}))

jest.mock('@open-mercato/ui/backend/DataTable', () => ({
  DataTable: (props: any) => (
    <div data-testid="data-table-mock">
      <div data-testid="data-table-title">{props.title}</div>
      <button data-testid="search-trigger" onClick={() => props.onSearchChange?.('USD')}>
        trigger-search
      </button>
      <div data-testid="row-actions-non-base">
        {props.rowActions?.({
          id: 'cur-1',
          code: 'EUR',
          isBase: false,
          organizationId: 'org-1',
          tenantId: 'ten-1',
          updatedAt: '2024-01-01',
        })}
      </div>
      <div data-testid="row-actions-base">
        {props.rowActions?.({
          id: 'cur-2',
          code: 'USD',
          isBase: true,
          organizationId: 'org-1',
          tenantId: 'ten-1',
        })}
      </div>
    </div>
  ),
}))

jest.mock('@open-mercato/ui/backend/RowActions', () => ({
  RowActions: ({ items }: any) => (
    <div>
      {items.map((item: any, idx: number) => (
        <button key={item.id} data-testid={`row-action-${item.id}`} onClick={() => item.onSelect?.()}>
          {item.label}
        </button>
      ))}
    </div>
  ),
}))

jest.mock('@open-mercato/ui/primitives/button', () => ({
  Button: ({ children, asChild, ...rest }: any) =>
    asChild ? <span {...rest}>{children}</span> : <button {...rest}>{children}</button>,
}))

jest.mock('@open-mercato/ui/primitives/badge', () => ({
  Badge: ({ children }: any) => <span>{children}</span>,
}))

jest.mock('@open-mercato/ui/backend/ValueIcons', () => ({
  BooleanIcon: ({ value }: { value: boolean }) => <span>{String(value)}</span>,
}))

let scopedHeaderStack: Record<string, string> = {}
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
  withScopedApiRequestHeaders: (headers: Record<string, string>, run: () => unknown) => {
    const previous = scopedHeaderStack
    scopedHeaderStack = { ...previous, ...headers }
    try {
      return run()
    } finally {
      scopedHeaderStack = previous
    }
  },
}))

jest.mock('@open-mercato/ui/backend/conflicts', () => ({
  surfaceRecordConflict: jest.fn(() => false),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({
  useOrganizationScopeVersion: jest.fn().mockReturnValue(1),
}))

jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({
    confirm: jest.fn(() => new Promise<boolean>((resolve) => {
      setTimeout(() => resolve(true), 0)
    })),
    ConfirmDialogElement: null,
  }),
}))

jest.mock('lucide-react', () => ({
  Plus: () => null,
  Star: () => null,
}))

HTMLDialogElement.prototype.showModal = jest.fn(function (this: HTMLDialogElement) {
  this.open = true
  this.setAttribute('open', '')
})
HTMLDialogElement.prototype.close = jest.fn(function (this: HTMLDialogElement) {
  this.open = false
  this.removeAttribute('open')
})

type RecordedApiCall = { url: string; init?: Record<string, unknown>; scopedHeaders: Record<string, string> }
let recordedApiCalls: RecordedApiCall[] = []

const LIST_RESULT = {
  ok: true,
  status: 200,
  result: {
    items: [
      { id: 'cur-1', code: 'EUR', name: 'Euro', symbol: '€', decimalPlaces: 2, isBase: false, isActive: true, organizationId: 'org-1', tenantId: 'ten-1', createdAt: '2024-01-01', updatedAt: '2024-01-01' },
      { id: 'cur-2', code: 'USD', name: 'US Dollar', symbol: '$', decimalPlaces: 2, isBase: true, isActive: true, organizationId: 'org-1', tenantId: 'ten-1', createdAt: '2024-01-01', updatedAt: '2024-01-01' },
    ],
    total: 2,
    page: 1,
    totalPages: 1,
  },
}

describe('CurrenciesPage', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    recordedApiCalls = []
    scopedHeaderStack = {}
    ;(apiCall as jest.Mock).mockImplementation((url: string, init?: Record<string, unknown>) => {
      recordedApiCalls.push({ url, init, scopedHeaders: { ...scopedHeaderStack } })
      return Promise.resolve(LIST_RESULT)
    })
    ;(surfaceRecordConflict as jest.Mock).mockReturnValue(false)
  })

  it('loads currencies from the correct API endpoint', async () => {
    render(<CurrenciesPage />)

    await waitFor(() => expect(apiCall).toHaveBeenCalled())
    expect((apiCall as jest.Mock).mock.calls[0][0]).toContain('/api/currencies/currencies?page=1&pageSize=50')
  })

  it('passes search query to the correct API endpoint', async () => {
    render(<CurrenciesPage />)
    await waitFor(() => expect(apiCall).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByTestId('search-trigger'))

    await waitFor(() => expect(apiCall).toHaveBeenCalledTimes(2))
    const secondCallUrl = (apiCall as jest.Mock).mock.calls[1][0] as string
    expect(secondCallUrl).toContain('/api/currencies/currencies')
    expect(secondCallUrl).toContain('search=USD')
  })

  it('handleSetBase calls PUT /api/currencies/currencies', async () => {
    render(<CurrenciesPage />)
    await waitFor(() => expect(apiCall).toHaveBeenCalledTimes(1))

    const setBaseButton = screen.getByTestId('row-action-set-base')
    fireEvent.click(setBaseButton)

    await waitFor(() => {
      const putCall = (apiCall as jest.Mock).mock.calls.find(
        (call: unknown[]) => typeof call[1] === 'object' && (call[1] as Record<string, unknown>).method === 'PUT',
      )
      expect(putCall).toBeDefined()
      expect(putCall[0]).toBe('/api/currencies/currencies')
    })
  })

  it('handleDelete calls DELETE /api/currencies/currencies after confirmation', async () => {
    render(<CurrenciesPage />)
    await waitFor(() => expect(apiCall).toHaveBeenCalledTimes(1))

    const deleteButton = screen.getByTestId('row-action-delete')
    fireEvent.click(deleteButton)

    await waitFor(() => {
      const deleteCall = (apiCall as jest.Mock).mock.calls.find(
        (call: unknown[]) => typeof call[1] === 'object' && (call[1] as Record<string, unknown>).method === 'DELETE',
      )
      expect(deleteCall).toBeDefined()
      expect(deleteCall[0]).toBe('/api/currencies/currencies')
    })
  })

  it('handleDelete sends the optimistic-lock header from the row updatedAt', async () => {
    render(<CurrenciesPage />)
    await waitFor(() => expect(apiCall).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByTestId('row-action-delete'))

    await waitFor(() => {
      const deleteCall = recordedApiCalls.find(
        (call) => (call.init as Record<string, unknown> | undefined)?.method === 'DELETE',
      )
      expect(deleteCall).toBeDefined()
      expect(deleteCall?.scopedHeaders[OPTIMISTIC_LOCK_HEADER]).toBe('2024-01-01')
    })
  })

  it('handleDelete routes a 409 conflict through surfaceRecordConflict instead of a generic flash', async () => {
    render(<CurrenciesPage />)
    await waitFor(() => expect(apiCall).toHaveBeenCalledTimes(1))

    ;(apiCall as jest.Mock).mockImplementation((url: string, init?: Record<string, unknown>) => {
      recordedApiCalls.push({ url, init, scopedHeaders: { ...scopedHeaderStack } })
      if ((init as Record<string, unknown> | undefined)?.method === 'DELETE') {
        return Promise.resolve({ ok: false, status: 409, result: { code: 'optimistic_lock_conflict', currentUpdatedAt: '2024-02-02', expectedUpdatedAt: '2024-01-01' } })
      }
      return Promise.resolve(LIST_RESULT)
    })
    ;(surfaceRecordConflict as jest.Mock).mockReturnValue(true)

    fireEvent.click(screen.getByTestId('row-action-delete'))

    await waitFor(() => expect(surfaceRecordConflict as jest.Mock).toHaveBeenCalled())
    const conflictArg = (surfaceRecordConflict as jest.Mock).mock.calls[0][0] as Record<string, unknown>
    expect(conflictArg.status).toBe(409)
    expect(conflictArg.code).toBe('optimistic_lock_conflict')
    // When the conflict surface owns the resolution, the generic delete-error flash is suppressed.
    expect(flash).not.toHaveBeenCalledWith('currencies.flash.deleteError', 'error')
  })
})
