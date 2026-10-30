/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { HelpTip } from '../HelpTip'

const plDict = {
  'ui.helpTip.ariaLabel': 'Co to jest?',
}

describe('HelpTip', () => {
  it('stays closed until it is asked for', () => {
    renderWithProviders(<HelpTip title="Segments" body="A saved audience." />)

    expect(screen.queryByText('A saved audience.')).toBeNull()
  })

  it('opens on click rather than hover, because long-press is not a discoverable affordance', () => {
    renderWithProviders(<HelpTip title="Segments" body="A saved audience." />)

    fireEvent.click(screen.getByRole('button', { name: 'What is this?' }))

    expect(screen.getByText('A saved audience.')).toBeTruthy()
  })

  it('names the card after the thing it explains, so a screen reader announces more than "dialog"', () => {
    renderWithProviders(<HelpTip title="Segments" body="A saved audience." />)

    fireEvent.click(screen.getByRole('button', { name: 'What is this?' }))

    expect(screen.getByRole('dialog', { name: 'Segments' })).toBeTruthy()
  })

  it('translates the trigger label for the active locale', () => {
    renderWithProviders(<HelpTip title="Segmenty" body="Zapisana grupa odbiorców." />, {
      locale: 'pl',
      dict: plDict,
    })

    expect(screen.getByRole('button', { name: 'Co to jest?' })).toBeTruthy()
  })
})
