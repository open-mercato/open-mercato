/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { act } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import enDict from '../i18n/en.json'
import { ClaimSlaIndicator, computeClaimSlaState } from '../backend/components/claimSla'

describe('ClaimSlaIndicator', () => {
  it('computes at-risk and overdue transitions at explicit wall-clock boundaries', () => {
    const input = {
      submittedAt: '2026-08-12T00:00:00.000Z',
      slaDueAt: '2026-08-12T10:00:00.000Z',
      status: 'submitted',
      atRiskThresholdPct: 75,
    }
    expect(computeClaimSlaState({ ...input, now: Date.parse('2026-08-12T07:29:59.000Z') }).tier).toBe('ok')
    expect(computeClaimSlaState({ ...input, now: Date.parse('2026-08-12T07:30:00.000Z') }).tier).toBe('at_risk')
    expect(computeClaimSlaState({ ...input, now: Date.parse('2026-08-12T10:00:00.000Z') }).tier).toBe('overdue')
  })

  it('re-renders from the shared low-frequency clock when a threshold is crossed', () => {
    jest.useFakeTimers({ now: new Date('2026-08-12T07:29:30.000Z') })
    try {
      const view = renderWithProviders(
        <ClaimSlaIndicator
          submittedAt="2026-08-12T00:00:00.000Z"
          slaDueAt="2026-08-12T10:00:00.000Z"
          status="submitted"
          atRiskThresholdPct={75}
        />,
        { dict: enDict },
      )
      expect(view.queryByText(/At risk/)).toBeNull()

      act(() => {
        jest.advanceTimersByTime(30_000)
      })

      expect(view.getByText(/At risk/)).toBeTruthy()
    } finally {
      jest.useRealTimers()
    }
  })
})
