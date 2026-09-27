/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { AppearanceSelector, type AppearanceSelectorLabels } from '../AppearanceSelector'

jest.mock('@open-mercato/ui/primitives/color-picker', () => ({
  ColorPicker: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input type="color" {...props} />,
}))

const labels: AppearanceSelectorLabels = {
  colorLabel: 'Color',
  colorHelp: 'Pick a highlight color.',
  colorClearLabel: 'Remove color',
  iconLabel: 'Icon or emoji',
  iconPlaceholder: 'Type an emoji or icon token.',
  iconPickerTriggerLabel: 'Browse icons and emoji',
  iconSearchPlaceholder: 'Search icons or emojis…',
  iconSearchEmptyLabel: 'No icons match your search.',
  iconSuggestionsLabel: 'Suggestions',
  iconClearLabel: 'Remove icon',
  previewEmptyLabel: 'No appearance selected',
}

describe('AppearanceSelector accessibility', () => {
  it('associates the visible icon label with its text input', () => {
    render(
      <AppearanceSelector
        icon={null}
        color={null}
        onIconChange={jest.fn()}
        onColorChange={jest.fn()}
        labels={labels}
      />,
    )

    expect(screen.getByRole('textbox', { name: 'Icon or emoji' })).toBeInTheDocument()
  })
})
