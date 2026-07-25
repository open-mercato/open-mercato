/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom'
import * as React from 'react'
import { render } from '@testing-library/react'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import {
  getSyncRunStatusVariant,
  getSyncSummaryVariant,
  syncRunStatusVariants,
  syncSummaryVariants,
} from '../syncRunStatus'

const HARDCODED_STATUS_COLOR = /(bg|text|border)-(green|red|blue|gray|yellow|orange|emerald|amber|sky|rose|slate)-\d{2,3}/

describe('data_sync syncRunStatus helper', () => {
  it('maps every run status to a semantic design-system variant', () => {
    expect(syncRunStatusVariants).toEqual({
      pending: 'neutral',
      running: 'info',
      completed: 'success',
      failed: 'error',
      cancelled: 'warning',
      paused: 'warning',
    })
  })

  it('falls back to neutral for unknown run statuses', () => {
    expect(getSyncRunStatusVariant('something-else')).toBe('neutral')
  })

  it('maps summary kinds to semantic variants', () => {
    expect(syncSummaryVariants).toEqual({
      enabled: 'success',
      ready: 'success',
      disabled: 'neutral',
      missing: 'warning',
      scheduled: 'info',
      paused: 'warning',
      none: 'neutral',
    })
    expect(getSyncSummaryVariant('enabled')).toBe('success')
    expect(getSyncSummaryVariant('missing')).toBe('warning')
  })

  it('renders run-status badges with semantic status tokens, never raw Tailwind colors', () => {
    for (const status of Object.keys(syncRunStatusVariants)) {
      const { container, unmount } = render(
        <StatusBadge variant={getSyncRunStatusVariant(status)}>{status}</StatusBadge>,
      )
      const badge = container.querySelector('[data-slot="badge"]')
      expect(badge).not.toBeNull()
      expect(badge?.className).toContain('-status-')
      expect(badge?.className ?? '').not.toMatch(HARDCODED_STATUS_COLOR)
      unmount()
    }
  })
})
