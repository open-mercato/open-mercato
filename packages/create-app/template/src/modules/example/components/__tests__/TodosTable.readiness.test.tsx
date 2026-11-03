/** @jest-environment jsdom */
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import type { CustomFieldDefDto } from '@open-mercato/ui/backend/utils/customFieldDefs'
import TodosTable from '../TodosTable'
import polish from '../../i18n/pl.json'

let mockDefinitions: { data: CustomFieldDefDto[] | undefined; isLoading: boolean } = { data: undefined, isLoading: true }
const mockTranslate = (key: string) => (polish as Record<string, string>)[key] ?? key

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({ useT: () => mockTranslate }))
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }))
jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
  useQuery: () => ({ data: { items: [], total: 0 }, isLoading: false }),
}))
jest.mock('@open-mercato/ui/backend/utils/customFieldDefs', () => ({ useCustomFieldDefs: () => mockDefinitions, isDefVisible: () => true }))
jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({ useOrganizationScopeVersion: () => 0 }))
jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({ useConfirmDialog: () => ({ confirm: jest.fn(), ConfirmDialogElement: null }) }))
jest.mock('@open-mercato/ui/backend/ValueIcons', () => ({ BooleanIcon: () => null, EnumBadge: () => null, useSeverityPreset: () => ({}) }))
jest.mock('@open-mercato/ui/backend/DataTable', () => ({
  DataTable: ({ columns, isLoading }: { columns: Array<{ header: string }>; isLoading: boolean }) => (
    isLoading ? <div role="status">Loading</div> : <table><thead><tr>{columns.map((column) => <th key={column.header}>{column.header}</th>)}</tr></thead></table>
  ),
}))

it('waits for custom fields before showing the final Polish headers', () => {
  mockDefinitions = { data: undefined, isLoading: true }
  const { rerender } = render(<TodosTable />)
  expect(screen.queryAllByRole('columnheader')).toHaveLength(0)
  mockDefinitions = {
    isLoading: false,
    data: [
      { key: 'priority', kind: 'integer', label: 'Priority' },
      { key: 'severity', kind: 'select', label: 'Severity' },
      { key: 'blocked', kind: 'boolean', label: 'Blocked' },
      { key: 'labels', kind: 'text', label: 'Labels' },
      { key: 'description', kind: 'multiline', label: 'Description' },
      { key: 'assignee', kind: 'select', label: 'Assignees' },
    ],
  }
  rerender(<TodosTable />)
  expect(screen.getAllByRole('columnheader').map((header) => header.textContent)).toEqual([
    'Tytuł', 'Organizacja', 'Zakończone', 'Priorytet', 'Poziom ważności', 'Zablokowane', 'Etykiety', 'Opis', 'Przypisane osoby',
  ])
})


it('preserves an administrator-customized label after definitions load', () => {
  mockDefinitions = { isLoading: false, data: [{ key: 'priority', kind: 'integer', label: 'Business priority' }] }
  render(<TodosTable />)
  expect(screen.getAllByRole('columnheader').map((header) => header.textContent)).toContain('Business priority')
  expect(screen.queryByRole('columnheader', { name: 'Priorytet' })).toBeNull()
})
