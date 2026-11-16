/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { screen, within } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import type { DictionaryEntryRecord } from '../hooks/useDictionaryEntries'

const mockFullEntries: DictionaryEntryRecord[] = [
  { id: 'entry-1', value: 'both', label: 'Both', color: '#16a34a', icon: 'lucide:check', createdAt: null, updatedAt: null },
  { id: 'entry-2', value: 'color', label: 'Colour only', color: '#2563eb', icon: null, createdAt: null, updatedAt: null },
  { id: 'entry-3', value: 'none', label: 'Neither', color: null, icon: null, createdAt: null, updatedAt: null },
]

jest.mock('../hooks/useDictionaryEntries', () => ({
  useDictionaryEntries: () => ({
    data: { entries: mockFullEntries, map: {}, fullEntries: mockFullEntries },
    isLoading: false,
    isError: false,
  }),
  invalidateDictionaryEntries: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: async <T,>({ operation }: { operation: () => Promise<T> }) => operation(),
    retryLastMutation: jest.fn(),
  }),
}))

jest.mock('@open-mercato/core/modules/translations/components/TranslationManager', () => ({
  TranslationManager: () => null,
}))

import { DictionaryEntriesEditor } from '../DictionaryEntriesEditor'

function appearanceCell(rowLabel: string): HTMLElement {
  const row = screen.getByRole('cell', { name: rowLabel }).closest('tr') as HTMLElement
  return within(row).getAllByRole('cell')[2]
}

describe('DictionaryEntriesEditor appearance column', () => {
  it('shows the icon and the colour of an entry instead of repeating its label', () => {
    renderWithProviders(<DictionaryEntriesEditor dictionaryId="dictionary-1" dictionaryName="Statuses" />)

    const both = appearanceCell('Both')
    expect(both.querySelector('svg')).not.toBeNull()
    expect(both.querySelector('span[style*="background-color"]')).toHaveStyle({ backgroundColor: '#16a34a' })
    expect(both).not.toHaveTextContent('Both')

    const colourOnly = appearanceCell('Colour only')
    expect(colourOnly.querySelector('svg')).toBeNull()
    expect(colourOnly.querySelector('span[style*="background-color"]')).toHaveStyle({ backgroundColor: '#2563eb' })
  })

  it('reads None when an entry has neither an icon nor a colour', () => {
    renderWithProviders(<DictionaryEntriesEditor dictionaryId="dictionary-1" dictionaryName="Statuses" />)

    expect(appearanceCell('Neither')).toHaveTextContent('None')
  })
})
