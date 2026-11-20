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
  it.each([null, undefined, ''])('hides an empty dealId row beside a comment edit (before: %s)', (before) => {
    renderWithProviders(
      <FieldDiffCard fieldDiff={[
        { field: 'dealId', before, after: '' },
        { field: 'body', before: 'old', after: 'new 2' },
      ]} />,
      { dict },
    )

    expect(screen.queryByText('dealId')).not.toBeInTheDocument()
    expect(screen.getByText('old')).toBeInTheDocument()
    expect(screen.getByText('new 2')).toBeInTheDocument()
    expect(document.querySelectorAll('[data-ai-field-diff-row]')).toHaveLength(1)
  })

  it('keeps additions, clears, false, zero and distinct values with the same display label', () => {
    renderWithProviders(
      <FieldDiffCard fieldDiff={[
        { field: 'addition', before: null, after: 'New value' },
        { field: 'clear', before: 'Old value', after: '' },
        { field: 'enabled', before: null, after: false },
        { field: 'count', before: '', after: 0 },
        { field: 'stage', before: 'id-1', after: 'id-2', beforeDisplay: 'Same label', afterDisplay: 'Same label' },
      ]} />,
      { dict },
    )

    expect(document.querySelectorAll('[data-ai-field-diff-row]')).toHaveLength(5)
    expect(screen.getByText('New value')).toBeInTheDocument()
    expect(screen.getByText('Old value')).toBeInTheDocument()
    expect(screen.getByText('false')).toBeInTheDocument()
    expect(screen.getByText('0')).toBeInTheDocument()
    expect(screen.getAllByText('Same label')).toHaveLength(2)
  })

  it('shows the empty state when all single-record rows are empty', () => {
    renderWithProviders(
      <FieldDiffCard fieldDiff={[{ field: 'dealId', before: '', after: null }]} />,
      { dict },
    )

    expect(screen.getByText('No field changes for this record.')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('filters empty rows in batch previews and retains each record and its empty state', () => {
    renderWithProviders(
      <FieldDiffCard
        fieldDiff={[{ field: 'ignoredFlatField', before: 'a', after: 'b' }]}
        records={[
          { recordId: 'comment-1', entityType: 'customers.comment', label: 'Comment 1', fieldDiff: [
            { field: 'dealId', before: null, after: '' },
            { field: 'body', before: 'old', after: 'new 2' },
          ] },
          { recordId: 'comment-2', entityType: 'customers.comment', label: 'Comment 2', fieldDiff: [
            { field: 'dealId', before: '', after: undefined },
          ] },
        ]}
      />,
      { dict },
    )

    expect(screen.queryByText('dealId')).not.toBeInTheDocument()
    expect(screen.queryByText('ignoredFlatField')).not.toBeInTheDocument()
    expect(screen.getByText('new 2')).toBeInTheDocument()
    expect(screen.getByText('Comment 2')).toBeInTheDocument()
    expect(screen.getByText('No field changes for this record.')).toBeInTheDocument()
    expect(document.querySelectorAll('[data-ai-field-diff-row]')).toHaveLength(1)
  })

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

  it('prefers display labels while preserving raw diff fields for the row contract', () => {
    renderWithProviders(
      <FieldDiffCard
        fieldDiff={[
          {
            field: 'pipelineStageId',
            fieldLabel: 'Pipeline stage',
            before: '11111111-1111-4111-8111-111111111111',
            after: '22222222-2222-4222-8222-222222222222',
            beforeDisplay: 'Offering',
            afterDisplay: 'Lost',
          },
        ]}
      />,
      { dict },
    )

    expect(screen.getByText('Pipeline stage')).toBeInTheDocument()
    expect(screen.getByText('Offering')).toBeInTheDocument()
    expect(screen.getByText('Lost')).toBeInTheDocument()
    expect(screen.queryByText('11111111-1111-4111-8111-111111111111')).not.toBeInTheDocument()
    expect(screen.queryByText('22222222-2222-4222-8222-222222222222')).not.toBeInTheDocument()
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
