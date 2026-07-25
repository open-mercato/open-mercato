/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render } from '@testing-library/react'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { RunStatusBadge, RUN_STATUS_BADGE_VARIANTS } from '../widget.client'

const translate: TranslateFn = (key, fallbackOrParams) =>
  typeof fallbackOrParams === 'string' ? fallbackOrParams : key

const HARDCODED_STATUS_COLOR = /(emerald|zinc-\d|blue-500|red-300|red-500)/

const statusCases: Array<{
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'idle'
  variant: string
  label: string
}> = [
  { status: 'completed', variant: 'success', label: 'Completed' },
  { status: 'failed', variant: 'error', label: 'Failed' },
  { status: 'cancelled', variant: 'neutral', label: 'Cancelled' },
  { status: 'pending', variant: 'info', label: 'Pending' },
  { status: 'running', variant: 'info', label: 'Running' },
  { status: 'idle', variant: 'neutral', label: 'Idle' },
]

describe('RunStatusBadge — semantic status tokens', () => {
  it.each(statusCases)(
    'renders $status with the $variant StatusBadge variant and no hardcoded status colors',
    ({ status, variant, label }) => {
      const { container, getByText } = render(<RunStatusBadge status={status} t={translate} />)

      const badge = container.querySelector('[data-slot="badge"]') as HTMLElement | null
      expect(badge).not.toBeNull()
      expect(badge?.getAttribute('data-variant')).toBe(variant)
      expect(badge?.className).not.toMatch(HARDCODED_STATUS_COLOR)
      expect(getByText(label)).toBeTruthy()
    },
  )

  it('maps every run status to a semantic variant', () => {
    expect(RUN_STATUS_BADGE_VARIANTS).toEqual({
      completed: 'success',
      failed: 'error',
      cancelled: 'neutral',
      pending: 'info',
      running: 'info',
      idle: 'neutral',
    })
  })
})
