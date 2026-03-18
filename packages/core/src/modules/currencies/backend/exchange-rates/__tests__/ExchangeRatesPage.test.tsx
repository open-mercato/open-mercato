/**
 * @jest-environment jsdom
 */
import type React from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import ExchangeRatesPage from '../page'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'

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
      <div data-testid="row-actions-wrapper">
        {props.rowActions?.({
          id: 'rate-1',
          fromCurrencyCode: 'EUR',
          toCurrencyCode: 'USD',
          rate: '1.10',
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
      {items.map((item: any) => (
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

jest.mock('@open-mercato/ui/backend/ValueIcons', () => ({
  BooleanIcon: ({ value }: { value: boolean }) => <span>{String(value)}</span>,
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
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
}))

HTMLDialogElement.prototype.showModal = jest.fn(function (this: HTMLDialogElement) {
  this.open = true
  this.setAttribute('open', '')
})
HTMLDialogElement.prototype.close = jest.fn(function (this: HTMLDialogElement) {
  this.open = false
  this.removeAttribute('open')
})

describe('ExchangeRatesPage', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(apiCall as jest.Mock).mockResolvedValue({
      ok: true,
      result: {
        items: [
          { id: 'rate-1', fromCurrencyCode: 'EUR', toCurrencyCode: 'USD', rate: '1.10', date: '2024-01-01', source: 'Manual', type: null, isActive: true, organizationId: 'org-1', tenantId: 'ten-1', createdAt: '2024-01-01', updatedAt: '2024-01-01' },
        ],
        total: 1,
        page: 1,
        totalPages: 1,
      },
    })
  })

  it('loads exchange rates from the correct API endpoint', async () => {
    render(<ExchangeRatesPage />)

    await waitFor(() => expect(apiCall).toHaveBeenCalled())
    expect((apiCall as jest.Mock).mock.calls[0][0]).toContain('/api/currencies/exchange-rates?page=1&pageSize=50')
  })

  it('handleDelete calls DELETE /api/currencies/exchange-rates after confirmation', async () => {
    render(<ExchangeRatesPage />)
    await waitFor(() => expect(apiCall).toHaveBeenCalledTimes(1))

    const deleteButton = screen.getByTestId('row-action-delete')
    fireEvent.click(deleteButton)

    await waitFor(() => {
      const deleteCall = (apiCall as jest.Mock).mock.calls.find(
        (call: unknown[]) => typeof call[1] === 'object' && (call[1] as Record<string, unknown>).method === 'DELETE',
      )
      expect(deleteCall).toBeDefined()
      expect(deleteCall[0]).toBe('/api/currencies/exchange-rates')
    })
  })
})
