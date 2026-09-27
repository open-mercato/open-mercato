/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { DictionaryEntriesEditor } from '../DictionaryEntriesEditor'

jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({
  useOrganizationScopeVersion: () => 1,
}))

jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({ confirm: jest.fn(), ConfirmDialogElement: null }),
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({ runMutation: jest.fn(), retryLastMutation: jest.fn() }),
}))

jest.mock('../AppearanceSelector', () => ({
  AppearanceSelector: () => null,
  useAppearanceState: () => ({
    color: null,
    icon: null,
    setColor: jest.fn(),
    setIcon: jest.fn(),
  }),
}))

jest.mock('../dictionaryAppearance', () => ({
  DictionaryValue: ({ value }: { value: string }) => <span>{value}</span>,
}))

jest.mock('../hooks/useDictionaryEntries', () => ({
  invalidateDictionaryEntries: jest.fn(),
  useDictionaryEntries: () => ({
    data: {
      fullEntries: [{
        id: 'entry-1',
        value: 'priority',
        label: 'Priority',
        color: null,
        icon: null,
        updatedAt: '2026-09-27T00:00:00.000Z',
      }],
      map: {},
    },
    isLoading: false,
    isError: false,
  }),
}))

describe('DictionaryEntriesEditor accessibility', () => {
  test('names edit and delete icon actions for each entry', () => {
    renderWithProviders(
      <DictionaryEntriesEditor dictionaryId="dictionary-1" dictionaryName="Priorities" />,
    )

    expect(screen.getByRole('button', { name: 'Edit dictionary entry' })).toHaveAttribute(
      'title',
      'Edit dictionary entry',
    )
    expect(screen.getByRole('button', { name: 'Delete "Priority"?' })).toHaveAttribute(
      'title',
      'Delete "Priority"?',
    )
  })
})
