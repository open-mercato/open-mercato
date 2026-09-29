/** @jest-environment jsdom */
import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { TroubleshootingWalker, type TroubleshootingWalkerGuide } from '../backend/components/TroubleshootingWalker'

const guide: TroubleshootingWalkerGuide = {
  title: 'Diagnosis',
  steps: {
    prompt: 'Does it start?',
    options: [
      {
        label: 'No',
        next: {
          prompt: 'Is power connected?',
          options: [{ label: 'Yes', resolution: 'Inspect the unit' }],
        },
      },
    ],
  },
}

function view(callback: (path: number[]) => void) {
  return (
    <I18nProvider locale="en" dict={{}}>
      <TroubleshootingWalker guide={guide} onTraversedPathChange={callback} />
    </I18nProvider>
  )
}

describe('TroubleshootingWalker', () => {
  it('keeps the traversed path when the host callback identity changes', () => {
    const firstCallback = jest.fn()
    const rendered = render(view(firstCallback))

    fireEvent.click(screen.getByRole('button', { name: 'No' }))
    expect(screen.getByText('Is power connected?')).toBeInTheDocument()

    rendered.rerender(view(jest.fn()))

    expect(screen.getByText('Is power connected?')).toBeInTheDocument()
  })
})
