/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, screen, within } from '@testing-library/react'
import { DictionaryEntriesEditor } from '../DictionaryEntriesEditor'

jest.mock('@open-mercato/shared/lib/i18n/context', () => {
  const translate = (key: string, fallback?: unknown, params?: Record<string, unknown>) => {
    const template = typeof fallback === 'string' ? fallback : key
    const values = (typeof fallback === 'object' && fallback !== null ? fallback : params) as Record<string, unknown> | undefined
    return template.replace(/\{\{?(\w+)\}?\}/g, (match, name) => (values && name in values ? String(values[name]) : match))
  }
  return { useT: () => translate }
})

jest.mock('../hooks/useDictionaryEntries', () => ({
  invalidateDictionaryEntries: jest.fn(),
  useDictionaryEntries: () => ({
    data: {
      fullEntries: [
        { id: 'entry-1', value: 'budget_holder', label: 'Budget holder', color: null, icon: null },
        { id: 'entry-2', value: 'end_user', label: 'End user', color: null, icon: null },
      ],
      map: {},
    },
    isLoading: false,
    isError: false,
  }),
}))

jest.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({}) }))
jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({ useOrganizationScopeVersion: () => 0 }))
jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({ runMutation: jest.fn(), retryLastMutation: jest.fn() }),
}))
jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({ confirm: jest.fn(async () => false), ConfirmDialogElement: null }),
}))
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
  withScopedApiRequestHeaders: (_header: unknown, fn: () => unknown) => fn(),
}))
jest.mock('@open-mercato/ui/backend/utils/optimisticLock', () => ({ buildOptimisticLockHeader: () => ({}) }))
jest.mock('@open-mercato/ui/backend/conflicts', () => ({ surfaceRecordConflict: () => false }))
jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))
jest.mock('../AppearanceSelector', () => ({
  AppearanceSelector: () => null,
  useAppearanceState: () => ({ color: null, icon: null, setColor: jest.fn(), setIcon: jest.fn() }),
}))
jest.mock('../dictionaryAppearance', () => ({
  DictionaryValue: ({ value }: { value: string }) => <span>{value}</span>,
}))
jest.mock('@open-mercato/core/modules/translations/components/TranslationManager', () => ({
  TranslationManager: () => null,
}))

// Every entry row has three icon-only buttons. Two of them had no accessible
// name at all, and the third was named "Translate" on every row.
describe('DictionaryEntriesEditor row actions', () => {
  it('names each action after the entry it acts on', () => {
    render(<DictionaryEntriesEditor dictionaryId="dict-roles" dictionaryName="Roles" />)

    const row = screen.getByRole('row', { name: /budget_holder/ })
    expect(within(row).getByRole('button', { name: 'Edit Budget holder' })).toBeInTheDocument()
    expect(within(row).getByRole('button', { name: 'Translate Budget holder' })).toBeInTheDocument()
    expect(within(row).getByRole('button', { name: 'Delete Budget holder' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit End user' })).toBeInTheDocument()
  })

  it('leaves no button in the table without a name', () => {
    render(<DictionaryEntriesEditor dictionaryId="dict-roles" dictionaryName="Roles" />)

    const unnamed = within(screen.getByRole('table')).getAllByRole('button').filter((button) => !(button.getAttribute('aria-label') || button.textContent?.trim()))
    expect(unnamed).toHaveLength(0)
  })
})
