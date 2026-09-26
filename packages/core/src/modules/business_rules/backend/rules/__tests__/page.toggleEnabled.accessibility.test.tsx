/** @jest-environment jsdom */

import * as React from 'react'
import { render, screen } from '@testing-library/react'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string) => ({
    'common.disable': 'Disable',
    'common.enable': 'Enable',
    'common.yes': 'Yes',
    'common.no': 'No',
  })[key] ?? key,
}))

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }))
jest.mock('next/link', () => ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>))
jest.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: [], isLoading: false, error: null }),
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
}))

let capturedColumns: Array<{ id?: string; cell?: (ctx: any) => React.ReactNode }> = []
jest.mock('@open-mercato/ui/backend/DataTable', () => ({
  DataTable: (props: { columns: typeof capturedColumns }) => {
    capturedColumns = props.columns
    return <div data-testid="data-table-mock" />
  },
}))
jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({ confirm: jest.fn(), ConfirmDialogElement: null }),
}))

import RulesListPage from '../page'

function renderEnabledCell(ruleName: string, enabled: boolean) {
  capturedColumns = []
  render(<RulesListPage />)
  const enabledColumn = capturedColumns.find((column) => column.id === 'enabled')
  expect(enabledColumn?.cell).toBeTruthy()
  render(enabledColumn!.cell!({ row: { original: { id: 'rule-1', ruleName, enabled } } }) as React.ReactElement)
}

describe('business rules enabled toggle accessibility', () => {
  it('names an enabled rule toggle with the rule and resulting action', () => {
    renderEnabledCell('Payment Method Must Be Valid', true)
    expect(screen.getByRole('button', { name: 'Disable Payment Method Must Be Valid' })).toBeInTheDocument()
  })

  it('names a disabled rule toggle with the rule and resulting action', () => {
    renderEnabledCell('Orders Only During Business Hours', false)
    expect(screen.getByRole('button', { name: 'Enable Orders Only During Business Hours' })).toBeInTheDocument()
  })
})
