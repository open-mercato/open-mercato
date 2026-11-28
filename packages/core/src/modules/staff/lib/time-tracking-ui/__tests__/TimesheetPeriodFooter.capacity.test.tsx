/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { TimesheetPeriodFooter } from '../TimesheetPeriodFooter'
import type { TimesheetCapacity, TimesheetSummary } from '../timesheetData'

const mockSpotContexts: Array<Record<string, unknown>> = []

jest.mock('@open-mercato/ui/backend/injection/InjectionSpot', () => ({
  __esModule: true,
  InjectionSpot: ({ context }: { context: Record<string, unknown> }) => {
    mockSpotContexts.push(context)
    return null
  },
}))

const SUMMARY: TimesheetSummary = {
  totalMinutes: 0,
  billableMinutes: 0,
  targetMinutes: 720,
  deltaMinutes: -720,
  workingDays: 5,
}

const CAPACITY: TimesheetCapacity = {
  providerId: 'app.contract_hours',
  targetMinutesByDate: { '2026-07-13': 240 },
  totalTargetMinutes: 720,
  label: null,
}

function renderFooter(props: Partial<React.ComponentProps<typeof TimesheetPeriodFooter>>) {
  mockSpotContexts.length = 0
  return render(
    <I18nProvider locale="en" dict={{}}>
      <TimesheetPeriodFooter summary={SUMMARY} dailyHours={8} {...props} />
    </I18nProvider>,
  )
}

describe('TimesheetPeriodFooter with a contributed capacity (#6934)', () => {
  it('keeps the "days × hours" caption for the built-in target', () => {
    renderFooter({})
    expect(screen.getByText('Target (5 d × 8 h):')).toBeTruthy()
  })

  it('drops the "days × hours" caption when a provider answered', () => {
    renderFooter({ capacity: CAPACITY })
    expect(screen.getByText('Target:')).toBeTruthy()
    expect(screen.queryByText(/d × 8 h/)).toBeNull()
  })

  it("shows the provider's own label when it supplies one", () => {
    renderFooter({ capacity: { ...CAPACITY, label: 'Contract (½ FTE)' } })
    expect(screen.getByText('Contract (½ FTE):')).toBeTruthy()
  })

  it("translates the provider's labelKey, with label as the fallback", () => {
    renderFooter({ capacity: { ...CAPACITY, label: 'Contract', labelKey: 'app.capacity.unknownKey' } })
    expect(screen.getByText('Contract:')).toBeTruthy()
  })

  it('tells an injected widget which period and person are on screen', () => {
    renderFooter({
      capacity: CAPACITY,
      periodFrom: '2026-07-13',
      periodTo: '2026-07-19',
      staffMemberId: 'colleague-1',
    })
    expect(mockSpotContexts.at(-1)).toEqual({
      workingDays: 5,
      dailyHours: 8,
      periodFrom: '2026-07-13',
      periodTo: '2026-07-19',
      staffMemberId: 'colleague-1',
      capacityProviderId: 'app.contract_hours',
    })
  })
})
