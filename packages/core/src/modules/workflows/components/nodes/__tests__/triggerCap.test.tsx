/**
 * @jest-environment jsdom
 *
 * TriggerCap (fidelity gap #5, Direction A) — the trigger summary folded onto the
 * START node. Guards the states that must stay TRUE and the §4.6 rule that no
 * status is communicated by colour alone (glyph + label, and a named button).
 */
import * as React from 'react'
import { fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { TriggerCap } from '../TriggerCap'
import type { TriggerNodeModel } from '../../../lib/trigger-node'

const model = (over: Partial<TriggerNodeModel> = {}): TriggerNodeModel => ({
  rows: [],
  hiddenCount: 0,
  triggerCount: 0,
  enabledCount: 0,
  definitionEnabled: true,
  ...over,
})

describe('TriggerCap', () => {
  it('is a labelled button that opens the triggers editor on click', () => {
    const onOpen = jest.fn()
    renderWithProviders(<TriggerCap model={model({ triggerCount: 3, enabledCount: 2 })} onOpen={onOpen} />)

    const button = screen.getByTestId('workflow-trigger-cap')
    expect(button.tagName).toBe('BUTTON')
    expect(button.getAttribute('aria-label')).toContain('Edit triggers')

    fireEvent.click(button)
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('shows the trigger count alongside the manual/API line when events exist', () => {
    renderWithProviders(<TriggerCap model={model({ triggerCount: 3, enabledCount: 3 })} />)
    const button = screen.getByTestId('workflow-trigger-cap')
    expect(button.textContent).toContain('3 triggers')
    expect(button.textContent).toContain('manual / API start')
  })

  it('shows only the manual/API line for a definition with zero event triggers', () => {
    renderWithProviders(<TriggerCap model={model({ triggerCount: 0 })} />)
    const button = screen.getByTestId('workflow-trigger-cap')
    expect(button.textContent).toContain('manual / API start')
    expect(button.textContent).not.toContain('triggers')
  })

  it('states a disabled definition in words (never colour alone)', () => {
    renderWithProviders(<TriggerCap model={model({ triggerCount: 2, definitionEnabled: false })} />)
    const button = screen.getByTestId('workflow-trigger-cap')
    expect(button).toHaveAttribute('data-trigger-definition-disabled', 'true')
    expect(button.textContent).toContain('workflow disabled — nothing starts it')
  })
})
