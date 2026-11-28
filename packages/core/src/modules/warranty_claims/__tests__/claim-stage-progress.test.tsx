/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import enDict from '../i18n/en.json'
import { ClaimStageProgress } from '../backend/components/ClaimStageProgress'

describe('ClaimStageProgress', () => {
  it.each(['draft', 'approved', 'resolved'])('keeps all stage markers below sticky chrome for %s claims', (status) => {
    const view = renderWithProviders(<ClaimStageProgress status={status} />, { dict: enDict })
    const stages = view.getAllByRole('listitem')

    expect(stages).toHaveLength(5)
    stages.forEach((stage, index) => {
      const marker = stage.querySelector('span')
      expect(marker).not.toBeNull()
      expect(marker?.className).not.toMatch(/(?:^|\s)(?:relative|z-\d+)(?:\s|$)/)
      expect(stage.textContent).toContain(['Intake', 'Review', 'Approved', 'Goods-in', 'Resolved'][index])
    })
    const completedCount = status === 'resolved' ? 4 : status === 'approved' ? 2 : 0
    expect(stages.filter((stage) => stage.querySelector('span svg'))).toHaveLength(completedCount)
    expect(stages[completedCount].querySelector('span')?.textContent).toBe(String(completedCount + 1))
  })
})
