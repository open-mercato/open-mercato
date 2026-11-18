/** @jest-environment jsdom */
import * as React from 'react'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { AppearanceSelector, type AppearanceSelectorLabels } from '../AppearanceSelector'
import english from '../../i18n/en.json'
import polish from '../../i18n/pl.json'
import german from '../../i18n/de.json'
import spanish from '../../i18n/es.json'
import korean from '../../i18n/ko.json'

const labels: AppearanceSelectorLabels = {
  colorLabel: 'Color',
  colorClearLabel: 'Clear color',
  iconLabel: 'Icon',
  iconPlaceholder: 'Icon name',
  iconPickerTriggerLabel: 'Choose icon',
  iconSearchPlaceholder: 'Search icons',
  iconSearchEmptyLabel: 'No icons found',
  iconSuggestionsLabel: 'Suggestions',
  iconClearLabel: 'Clear icon',
  previewEmptyLabel: 'No appearance selected',
}

function selector(appearanceLabels = labels) {
  return <AppearanceSelector icon={null} color={null} onIconChange={jest.fn()} onColorChange={jest.fn()} labels={appearanceLabels} />
}

describe('AppearanceSelector preview heading', () => {
  it.each([
    ['en', english, 'Preview'],
    ['pl', polish, 'Podgląd'],
    ['de', german, 'Vorschau'],
    ['es', spanish, 'Vista previa'],
    ['ko', korean, '미리보기'],
  ] as const)('uses the %s module translation', (locale, dict, heading) => {
    renderWithProviders(selector(), { locale, dict })

    expect(screen.getByText(heading)).toBeInTheDocument()
    expect(screen.getByText(labels.previewEmptyLabel)).toBeInTheDocument()
    if (locale !== 'en') expect(screen.queryByText('Preview')).not.toBeInTheDocument()
  })

  it('retains the English fallback when the module key is not registered', () => {
    renderWithProviders(selector())

    expect(screen.getByText('Preview')).toBeInTheDocument()
  })
})
