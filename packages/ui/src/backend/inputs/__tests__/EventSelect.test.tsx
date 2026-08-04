/** @jest-environment jsdom */

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}))

jest.mock('../../utils/apiCall', () => ({
  apiCall: jest.fn(),
}))

jest.mock('../../../primitives/select', () => {
  const React = jest.requireActual<typeof import('react')>('react')
  return {
    Select: ({ children }: { children?: React.ReactNode }) => React.createElement('div', null, children),
    SelectContent: ({ children }: { children?: React.ReactNode }) => React.createElement('div', null, children),
    SelectGroup: ({ children }: { children?: React.ReactNode }) => React.createElement('div', null, children),
    SelectItem: ({ children, value }: { children?: React.ReactNode; value: string }) =>
      React.createElement('div', { 'data-value': value, role: 'option' }, children),
    SelectLabel: ({ children }: { children?: React.ReactNode }) => React.createElement('div', null, children),
    SelectTrigger: ({ children }: { children?: React.ReactNode }) => React.createElement('button', { type: 'button' }, children),
    SelectValue: ({ placeholder }: { placeholder?: string }) => React.createElement('span', null, placeholder),
  }
})

import * as React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { apiCall } from '../../utils/apiCall'
import { EventSelect } from '../EventSelect'

const apiCallMock = apiCall as unknown as jest.Mock

function renderEventSelect(props: Partial<React.ComponentProps<typeof EventSelect>> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { gcTime: 0, retry: false } },
  })
  const rendered = render(
    <QueryClientProvider client={queryClient}>
      <EventSelect value="" onChange={() => {}} {...props} />
    </QueryClientProvider>,
  )
  return { ...rendered, queryClient }
}

describe('EventSelect', () => {
  beforeEach(() => {
    apiCallMock.mockReset()
  })

  it('excludes events by explicit module and id prefix fallback', async () => {
    apiCallMock.mockResolvedValue({
      ok: true,
      result: {
        data: [
          { id: 'incidents.incident.created', label: 'Incident Created', module: 'incidents' },
          { id: 'incidents.legacy.created', label: 'Legacy Incident Created' },
          { id: 'sales.order.created', label: 'Order Created', module: 'sales' },
          { id: 'catalog.product.created', label: 'Product Created' },
        ],
        total: 4,
      },
    })

    const { queryClient } = renderEventSelect({ excludeModules: ['incidents'] })

    try {
      await waitFor(() => expect(screen.getByText('Order Created')).toBeInTheDocument())

      expect(screen.getByText('Product Created')).toBeInTheDocument()
      expect(screen.queryByText('Incident Created')).toBeNull()
      expect(screen.queryByText('Legacy Incident Created')).toBeNull()
    } finally {
      queryClient.clear()
    }
  })
})
