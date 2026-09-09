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

describe('IconButton pressed state', () => {
  // The pressed surface must be restated under `dark:` for the same reason:
  // `variant="outline"` (`dark:bg-input/30`) and `variant="ghost"`
  // (`dark:hover:bg-accent/50`) otherwise outrank `aria-pressed:bg-primary`
  // while `aria-pressed:text-primary-foreground` still applies, leaving a
  // dark icon on a dark surface (invisible favorite/watch toggles).
  it.each(['outline', 'ghost'] as const)('keeps the primary fill on a pressed %s button in dark mode', (variant) => {
    const classes = iconButtonVariants({ variant })
    expect(classes).toContain('not-disabled:aria-pressed:bg-primary')
    expect(classes).toContain('dark:not-disabled:aria-pressed:bg-primary')
    expect(classes).toContain('dark:not-disabled:aria-pressed:hover:bg-primary-hover')
  })

  // A toggle can be pressed and disabled at once — an active editor tool on a
  // read-only document. The pressed rules are more specific than the
  // `disabled:` surface, so without a not-disabled gate the disabled control
  // renders as a primary, actionable button in both themes.
  it.each(['outline', 'ghost'] as const)(
    'never lets the pressed surface outrank the disabled surface on a %s button',
    (variant) => {
      const classes = iconButtonVariants({ variant })
      expect(classes).toContain('disabled:bg-bg-disabled')
      expect(classes).toContain('disabled:text-text-disabled')
      for (const pressed of classes.split(' ').filter((cls) => cls.includes('aria-pressed:'))) {
        expect(pressed).toContain('not-disabled:aria-pressed:')
      }
    },
  )

  it('renders a pressed disabled toggle with only not-disabled-gated pressed rules', () => {
    const { getByRole } = render(
      <IconButton variant="outline" aria-label="Highlight" aria-pressed disabled>
        <svg />
      </IconButton>,
    )
    const classes = getByRole('button').className.split(' ')
    expect(classes).toContain('disabled:bg-bg-disabled')
    expect(classes).not.toContain('aria-pressed:bg-primary')
    expect(classes).not.toContain('dark:aria-pressed:bg-primary')
    expect(classes).toContain('not-disabled:aria-pressed:bg-primary')
  })

  // `enabled:` compiles to `&:enabled`, which the CSS spec restricts to form
  // elements. `IconButton` supports `asChild` and is rendered onto links across
  // the app (MessagesIcon, RoleAssignmentRow, DealsSection), so an `enabled:`
  // gate would silently drop the pressed state on every one of those hosts.
  // `not-disabled:` (`&:not(:disabled)`) matches a non-form host just fine.
  it('keeps the pressed surface on an asChild anchor host', () => {
    const { getByRole } = render(
      <IconButton variant="ghost" asChild aria-pressed>
        <a href="/inbox" aria-label="Messages">
          <svg />
        </a>
      </IconButton>,
    )
    const anchor = getByRole('link')
    const classes = anchor.className.split(' ')
    expect(anchor.tagName).toBe('A')
    expect(classes).toContain('not-disabled:aria-pressed:bg-primary')
    expect(classes).toContain('not-disabled:aria-pressed:text-primary-foreground')
    expect(classes).toContain('dark:not-disabled:aria-pressed:bg-primary')
    // The whole point of the fix: no pressed rule may be gated on `:enabled`,
    // which can never match an anchor.
    for (const pressed of classes.filter((cls) => cls.includes('aria-pressed:'))) {
      expect(pressed).not.toContain('enabled:aria-pressed:')
      expect(pressed).toContain('not-disabled:aria-pressed:')
    }
  })
})
