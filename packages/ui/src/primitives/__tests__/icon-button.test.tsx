/** @jest-environment jsdom */

import * as React from 'react'
import { render } from '@testing-library/react'
import { IconButton, iconButtonVariants } from '../icon-button'

describe('IconButton solid variants', () => {
  // Regression for issue #3507 (BUG-003): the timesheets TimerBar Start/Stop
  // icon buttons used `variant="outline"` and forced their fill via a
  // `bg-primary`/`bg-destructive` className. The outline variant ships a
  // `dark:bg-input/30` override that tailwind-merge cannot reconcile with a
  // base `bg-*` class, so in dark mode the intended solid fill was replaced by
  // the muted input surface and the dark `text-primary-foreground` play icon
  // became near-invisible. The fix is a proper solid `primary`/`destructive`
  // variant with NO `dark:` background override.

  it('primary variant applies the solid primary surface without a dark override', () => {
    const classes = iconButtonVariants({ variant: 'primary' })
    expect(classes).toContain('bg-primary')
    expect(classes).toContain('text-primary-foreground')
    expect(classes).not.toContain('dark:bg-input')
  })

  it('destructive variant applies the solid destructive surface without a dark override', () => {
    const classes = iconButtonVariants({ variant: 'destructive' })
    expect(classes).toContain('bg-destructive')
    expect(classes).not.toContain('dark:bg-input')
  })

  it('renders the primary fill on the element so the icon keeps contrast in both themes', () => {
    const { getByRole } = render(
      <IconButton variant="primary" aria-label="Start timer">
        <svg />
      </IconButton>,
    )
    const className = getByRole('button').className
    expect(className).toContain('bg-primary')
    expect(className).not.toContain('dark:bg-input')
  })
})
