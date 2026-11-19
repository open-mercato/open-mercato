/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { render, screen } from '@testing-library/react'
import en from '../../../../../../i18n/en.json'
import pl from '../../../../../../i18n/pl.json'

type Dictionary = Record<string, string>

let activeDictionary: Dictionary = en

jest.mock('@open-mercato/shared/lib/i18n/context', () => {
  const { createTranslator } = jest.requireActual('@open-mercato/shared/lib/i18n/translate')
  return { useT: () => createTranslator(activeDictionary) }
})

import { BulkActionsBar } from '../BulkActionsBar'

function renderBar(dictionary: Dictionary, totalLabel: string | null) {
  activeDictionary = dictionary
  render(
    <BulkActionsBar
      count={2}
      totalLabel={totalLabel}
      onChangeStage={jest.fn()}
      onChangeOwner={jest.fn()}
      onExportCsv={jest.fn()}
      onDelete={jest.fn()}
      onClear={jest.fn()}
    />,
  )
  return screen.getByRole('region')
}

describe('BulkActionsBar actions', () => {
  it.each([
    ['en', en, 'Change stage', ['Change owner', 'Export CSV', 'Delete']],
    ['pl', pl, 'Zmień etap', ['Zmień właściciela', 'Eksport CSV', 'Usuń']],
  ] as Array<[string, Dictionary, string, string[]]>)(
    'labels the stage action and keeps the other actions as named icon buttons in %s',
    (_locale, dictionary, labelled, iconOnly) => {
      renderBar(dictionary, null)

      const primary = screen.getByRole('button', { name: labelled })
      const label = Array.from(primary.querySelectorAll('span')).find((span) => span.textContent === labelled)
      expect(label?.className).toContain('sr-only')
      expect(label?.className).toContain('sm:not-sr-only')

      for (const name of iconOnly) {
        const button = screen.getByRole('button', { name })
        expect(button.textContent).toBe('')
        expect(button.getAttribute('aria-label')).toBe(name)
      }
    },
  )

  it('spans the content width as a sticky strip and wraps instead of pushing actions past the edge', () => {
    const bar = renderBar(en, null)

    expect(bar.className).toContain('sticky')
    expect(bar.className).toContain('w-full')
    expect(bar.className).not.toContain('fixed')
    expect(bar.className).toContain('flex-wrap')
  })

  it('shows the total without a middle-dot separator', () => {
    const bar = renderBar(pl, '2400 zł')

    expect(screen.getByTestId('kanban-bulk-total').textContent).toBe('Łącznie 2400 zł')
    expect(bar.textContent).not.toContain('·')
  })
})
