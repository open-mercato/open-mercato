/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { FieldDiffCard } from '../FieldDiffCard'

const dict = {
  'ai_assistant.chat.mutation_cards.diff.fieldHeader': 'Field',
  'ai_assistant.chat.mutation_cards.diff.beforeHeader': 'Before',
  'ai_assistant.chat.mutation_cards.diff.afterHeader': 'After',
  'ai_assistant.chat.mutation_cards.diff.empty': 'No field changes for this record.',
}

describe('FieldDiffCard', () => {
  it('renders before/after cells using semantic token classes', () => {
    renderWithProviders(
      <FieldDiffCard
        fieldDiff={[
          { field: 'name', before: 'Alice', after: 'Alicia' },
          { field: 'stage', before: 'prospect', after: 'qualified' },
        ]}
      />,
      { dict },
    )

    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('Alicia')).toBeInTheDocument()
    expect(screen.getByText('prospect')).toBeInTheDocument()
    expect(screen.getByText('qualified')).toBeInTheDocument()

    const before = screen.getAllByText('Alice')[0].closest('[data-ai-field-diff-before]')
    expect(before?.className).toContain('text-status-warning-text')
    const after = screen.getAllByText('Alicia')[0].closest('[data-ai-field-diff-after]')
    expect(after?.className).toContain('text-status-success-text')
  })

  it('renders an info placeholder when fieldDiff is empty (single-record mode)', () => {
    renderWithProviders(<FieldDiffCard fieldDiff={[]} />, { dict })
    expect(
      screen.getByText('No field changes for this record.'),
    ).toBeInTheDocument()
    // No table must be rendered in the empty state.
    expect(document.querySelector('[data-ai-field-diff-table]')).toBeNull()
  })

  it('renders batch records[] mode with one section per record', () => {
    renderWithProviders(
      <FieldDiffCard
        records={[
          {
            recordId: 'r-1',
            entityType: 'customers.person',
            label: 'Alice',
            fieldDiff: [{ field: 'name', before: 'Alice', after: 'Al' }],
          },
          {
            recordId: 'r-2',
            entityType: 'customers.person',
            label: 'Bob',
            fieldDiff: [{ field: 'name', before: 'Bob', after: 'Robert' }],
          },
        ]}
      />,
      { dict },
    )
    expect(document.querySelectorAll('[data-ai-field-diff-record]').length).toBe(2)
    expect(document.querySelectorAll('h4')[0].textContent).toBe('Alice')
    expect(document.querySelectorAll('h4')[1].textContent).toBe('Bob')
    expect(screen.getByText('Robert')).toBeInTheDocument()
  })
})
