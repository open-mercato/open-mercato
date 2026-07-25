/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { act, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { AiActionChips } from '../AiActionChips'
import { AI_TIMELINE_ACTIONS_BY_TYPE, resolveAiActions } from '../aiActionCatalog'

describe('AiActionChips', () => {
  it('renders each action chip through the shared Button primitive (no raw <button>)', async () => {
    const expectedActions = resolveAiActions('meeting', AI_TIMELINE_ACTIONS_BY_TYPE)
    expect(expectedActions.length).toBeGreaterThan(0)

    await act(async () => {
      renderWithProviders(<AiActionChips activityType="meeting" />)
    })

    const chipButtons = screen
      .getAllByRole('button')
      .filter((node) => node.getAttribute('data-slot') === 'button')
    expect(chipButtons.length).toBe(expectedActions.length)
  })
})
