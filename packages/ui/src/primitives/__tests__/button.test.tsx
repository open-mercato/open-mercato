/** @jest-environment jsdom */

import * as React from 'react'
import { render } from '@testing-library/react'
import { Button, buttonVariants } from '../button'

type ButtonVariant = NonNullable<Parameters<typeof buttonVariants>[0]>['variant']

function classesOf(variant: ButtonVariant) {
  return buttonVariants({ variant }).split(/\s+/).filter(Boolean)
}

describe('Button destructive variants', () => {
  // The DS policy: `destructive` is the quiet trigger (red text on a calm
  // surface) so a page full of delete buttons does not train users to ignore
  // red; `destructive-solid` is the filled form, reserved for the single
  // point-of-no-return confirmation inside a dialog. These tests pin both
  // halves of that contract — swapping them back is a visual regression that
  // no other test would catch.

  it('destructive is quiet: destructive border and text on the page surface', () => {
    const classes = classesOf('destructive')
    expect(classes).toContain('border')
    expect(classes).toContain('border-destructive')
    expect(classes).toContain('bg-background')
    expect(classes).toContain('text-destructive')
  })

  it('destructive does not fill with the destructive surface', () => {
    const classes = classesOf('destructive')
    expect(classes).not.toContain('bg-destructive')
    expect(classes).not.toContain('text-white')
  })

  it('destructive-solid fills with the destructive surface and white glyph', () => {
    const classes = classesOf('destructive-solid')
    expect(classes).toContain('bg-destructive')
    expect(classes).toContain('text-white')
    expect(classes).not.toContain('border-destructive')
  })

  it('destructive-solid ships no dark background override', () => {
    // `--destructive` is a semantic token that already resolves per theme; a
    // `dark:bg-*` override on top of it is what broke IconButton in #3507.
    const classes = classesOf('destructive-solid')
    expect(classes.some((cls) => cls.startsWith('dark:bg-'))).toBe(false)
  })

  it('renders the quiet treatment on the element for variant="destructive"', () => {
    const { getByRole } = render(<Button variant="destructive">Delete</Button>)
    const className = getByRole('button').className
    expect(className).toContain('text-destructive')
    expect(className).toContain('border-destructive')
    expect(className.split(/\s+/)).not.toContain('bg-destructive')
  })

  it('renders the filled treatment on the element for variant="destructive-solid"', () => {
    const { getByRole } = render(<Button variant="destructive-solid">Delete permanently</Button>)
    const classNames = getByRole('button').className.split(/\s+/)
    expect(classNames).toContain('bg-destructive')
    expect(classNames).toContain('text-white')
  })

  it('defaults to the primary variant when none is given', () => {
    const { getByRole } = render(<Button>Save</Button>)
    const classNames = getByRole('button').className.split(/\s+/)
    expect(classNames).toContain('bg-primary')
    expect(classNames).not.toContain('text-destructive')
  })
})
