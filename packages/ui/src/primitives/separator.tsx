"use client"

import * as React from 'react'

import { cn } from '@open-mercato/shared/lib/utils'

/**
 * Visual divider — horizontal or vertical. Phase B.3 rewrite (Figma
 * `Content Divider` page, componentSet `414:4401`) keeps the original
 * bare-rule API and adds the labeled / dashed / section variants.
 *
 * ## Backward compatibility (5 import sites)
 *
 * All five existing consumers pass `<Separator />` or `<Separator
 * className="my-4" />` and keep working verbatim:
 *
 *   customers/.../companies/[id]/page.tsx
 *   workflows/.../tasks/[id]/page.tsx
 *   workflows/components/EdgeEditDialog.tsx
 *   workflows/components/mobile/MobileTaskForm.tsx
 *   data_sync/.../data-sync/page.tsx
 *
 * ## Variants per Figma `Content Divider [1.1]`
 *
 *   plain          — `<Separator />`
 *   labeled        — `<Separator label="OR" />`
 *   labeled start  — `<Separator label="OR" labelAlign="start" />`
 *   section header — `<Separator section>AMOUNT & ACCOUNT</Separator>`
 *   dashed         — `<Separator variant="dashed" />`
 *
 * For the "rule + center button overlay" examples (Figma variants
 * 6-9 — `+` button, navigation, "Add" button, button row) the
 * primitive ships only the rule. Wrap your buttons in a parent
 * positioned over the separator at the consumer level — adding an
 * `overlay` slot to the primitive would multiply layout failure
 * modes (button width, button height, button spacing) far more
 * than the small win of saving the consumer wrap.
 */

export type SeparatorProps = {
  className?: string
  orientation?: 'horizontal' | 'vertical'
  /** Visual style of the rule. */
  variant?: 'solid' | 'dashed'
  /** Optional inline label. When set, the primitive renders as two
   * rule halves with the label between them (horizontal only).
   * Ignored for vertical orientation — pass plain children inside a
   * vertical flex container instead. */
  label?: React.ReactNode
  /** Alignment of the label between the two rule halves.
   * @default 'center' */
  labelAlign?: 'center' | 'start' | 'end'
  /** Section-header style — full-width bg-muted strip + uppercase
   * label (Figma variant 5: "AMOUNT & ACCOUNT" content header). When
   * `section` is true the `label` prop is rendered inside the strip;
   * or pass content via `children`. Mutually exclusive with
   * `label`/`labelAlign` (those use the inline-rule style). */
  section?: boolean
  /** Children — only consumed when `section` is true (the strip
   * label can be JSX). Ignored for non-section variants. */
  children?: React.ReactNode
}

// `solid` keeps the legacy `bg-border` painted-line approach for
// max backward compat with any consumers relying on box-model sizing.
// `dashed` requires `border-style` so it falls back to `border-t`
// with the painted line dropped via `h-0`.
const HORIZONTAL_RULE_CLASSES: Record<'solid' | 'dashed', string> = {
  solid: 'h-px bg-border',
  dashed: 'h-0 border-t border-dashed border-border',
}

const HORIZONTAL_LABELED_SEGMENT: Record<'solid' | 'dashed', string> = {
  solid: 'h-px bg-border',
  dashed: 'h-0 border-t border-dashed border-border',
}

const VERTICAL_RULE_CLASSES: Record<'solid' | 'dashed', string> = {
  solid: 'w-px bg-border',
  dashed: 'w-0 border-l border-dashed border-border',
}

export function Separator({
  className = '',
  orientation = 'horizontal',
  variant = 'solid',
  label,
  labelAlign = 'center',
  section = false,
  children,
}: SeparatorProps) {
  // ---- Section header variant (Figma 5: AMOUNT & ACCOUNT) ----------
  if (section) {
    return (
      <div
        role="separator"
        data-slot="separator"
        data-variant="section"
        aria-orientation="horizontal"
        className={cn(
          'w-full bg-muted px-3 py-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground',
          className,
        )}
      >
        {label ?? children}
      </div>
    )
  }

  // ---- Vertical rule (no label support — Figma doesn't ship that
  // pattern) -----------------------------------------------------------
  if (orientation === 'vertical') {
    return (
      <div
        role="separator"
        aria-orientation="vertical"
        data-slot="separator"
        data-variant={variant}
        className={cn('h-full', VERTICAL_RULE_CLASSES[variant], className)}
      />
    )
  }

  // ---- Horizontal rule with optional inline label -------------------
  if (label !== undefined) {
    const startSpan = labelAlign === 'start' ? 'w-6' : 'flex-1'
    const endSpan = labelAlign === 'end' ? 'w-6' : 'flex-1'
    return (
      <div
        role="separator"
        aria-orientation="horizontal"
        data-slot="separator"
        data-variant={variant}
        data-label-align={labelAlign}
        className={cn('flex w-full items-center gap-3', className)}
      >
        <span
          aria-hidden="true"
          data-slot="separator-rule"
          className={cn('shrink-0', HORIZONTAL_LABELED_SEGMENT[variant], startSpan)}
        />
        <span
          data-slot="separator-label"
          className="shrink-0 text-xs font-medium uppercase tracking-wide text-muted-foreground"
        >
          {label}
        </span>
        <span
          aria-hidden="true"
          data-slot="separator-rule"
          className={cn('shrink-0', HORIZONTAL_LABELED_SEGMENT[variant], endSpan)}
        />
      </div>
    )
  }

  // ---- Plain horizontal rule (original bare-line look) -------------
  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      data-slot="separator"
      data-variant={variant}
      className={cn('w-full', HORIZONTAL_RULE_CLASSES[variant], className)}
    />
  )
}
