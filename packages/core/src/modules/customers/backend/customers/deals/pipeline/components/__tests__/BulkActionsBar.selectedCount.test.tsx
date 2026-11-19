/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { render, screen } from '@testing-library/react'
import en from '../../../../../../i18n/en.json'
import pl from '../../../../../../i18n/pl.json'
import de from '../../../../../../i18n/de.json'
import es from '../../../../../../i18n/es.json'
import ko from '../../../../../../i18n/ko.json'

type Dictionary = Record<string, string>

let activeDictionary: Dictionary = en

jest.mock('@open-mercato/shared/lib/i18n/context', () => {
  const { createTranslator } = jest.requireActual('@open-mercato/shared/lib/i18n/translate')
  return { useT: () => createTranslator(activeDictionary) }
})

import { BulkActionsBar } from '../BulkActionsBar'

const SELECTED_COUNT_KEY = 'customers.deals.kanban.bulk.selectedCount'

function readParts(summary: HTMLElement): string {
  return Array.from(summary.children)
    .map((part) => part.textContent ?? '')
    .join(' ')
}

function renderBar(dictionary: Dictionary, count: number) {
  activeDictionary = dictionary
  render(
    <BulkActionsBar
      count={count}
      totalLabel={null}
      onChangeStage={jest.fn()}
      onChangeOwner={jest.fn()}
      onExportCsv={jest.fn()}
      onDelete={jest.fn()}
      onClear={jest.fn()}
    />,
  )
  return screen.getByTestId('kanban-bulk-selected-count')
}

describe('BulkActionsBar selected count (#9377)', () => {
  const locales: Array<[string, Dictionary]> = [
    ['en', en],
    ['pl', pl],
    ['de', de],
    ['es', es],
    ['ko', ko],
  ]

  it.each(locales)('shows the count once and no raw placeholder in %s', (_locale, dictionary) => {
    const summary = renderBar(dictionary, 7)
    const text = summary.textContent ?? ''

    expect(text).not.toContain('{')
    expect(text).not.toContain('}')
    expect(text.match(/7/g)).toHaveLength(1)
    expect(text.replace('7', '').trim().length).toBeGreaterThan(0)
  })

  it('puts the count where the Polish sentence expects it', () => {
    const summary = renderBar(pl, 2)

    expect(readParts(summary)).toBe('Zaznaczono: 2')
  })

  it('keeps the count in front of a label that has no placeholder', () => {
    const summary = renderBar({ ...en, [SELECTED_COUNT_KEY]: 'selected' }, 3)

    expect(readParts(summary)).toBe('3 selected')
  })

  it('resolves a double-brace placeholder the way the shared translator does', () => {
    const summary = renderBar({ ...en, [SELECTED_COUNT_KEY]: '{{count}} selected' }, 3)

    expect(readParts(summary)).toBe('3 selected')
    expect(summary.textContent).not.toContain('{')
    expect(summary.textContent).not.toContain('}')
  })

  it('keeps the count in front when the placeholder leads the sentence', () => {
    const summary = renderBar({ ...en, [SELECTED_COUNT_KEY]: '{count} selected' }, 3)

    expect(readParts(summary)).toBe('3 selected')
  })
})
