/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, screen } from '@testing-library/react'

const mockApiCall = jest.fn()

jest.mock('@open-mercato/shared/lib/i18n/context', () => {
  const translate = (key: string, fallback?: string) => fallback ?? key
  return { useT: () => translate }
})

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => mockApiCall(...args),
}))

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

import CustomerTodosWidget from '../widget.client'

function buildItem(overrides: Record<string, unknown>) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    todoId: '22222222-2222-4222-8222-222222222222',
    todoSource: 'customers:interaction',
    todoTitle: 'Call back about renewal',
    createdAt: '2026-10-01T10:00:00.000Z',
    entity: { id: '33333333-3333-4333-8333-333333333333', displayName: 'Ada Lovelace', kind: 'person' },
    ...overrides,
  }
}

function renderWidget() {
  return render(
    <CustomerTodosWidget
      mode={'view' as never}
      settings={{ pageSize: 5 } as never}
      onSettingsChange={jest.fn()}
      refreshToken={0}
      onRefreshStateChange={jest.fn()}
    />,
  )
}

describe('CustomerTodosWidget', () => {
  beforeEach(() => {
    mockApiCall.mockReset()
  })

  it('does not render raw todo source identifiers (#6946)', async () => {
    mockApiCall.mockResolvedValue({
      ok: true,
      status: 200,
      result: {
        items: [
          buildItem({}),
          buildItem({
            id: '44444444-4444-4444-8444-444444444444',
            todoId: '55555555-5555-4555-8555-555555555555',
            todoSource: 'example:todo',
            todoTitle: 'Send the proposal',
          }),
        ],
      },
    })

    renderWidget()

    expect(await screen.findByText('Call back about renewal')).toBeInTheDocument()
    expect(screen.getByText('Send the proposal')).toBeInTheDocument()
    expect(screen.queryByText('customers:interaction')).not.toBeInTheDocument()
    expect(screen.queryByText('example:todo')).not.toBeInTheDocument()
  })

  it('keeps the open-task link for external todo sources', async () => {
    mockApiCall.mockResolvedValue({
      ok: true,
      status: 200,
      result: {
        items: [
          buildItem({
            todoSource: 'example:todo',
            todoTitle: 'Send the proposal',
          }),
        ],
      },
    })

    renderWidget()

    const link = await screen.findByText('customers.workPlan.customerTodos.table.actions.openTask')
    expect(link.closest('a')).toHaveAttribute(
      'href',
      '/backend/todos/22222222-2222-4222-8222-222222222222/edit',
    )
  })
})
