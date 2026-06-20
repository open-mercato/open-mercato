"use client"

import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@open-mercato/shared/lib/utils'

/**
 * Joined / connected button group per Figma `Button Group [1.1]`
 * (component set id `199961:1616` in DS Open Mercato). Renders an outer
 * rounded border with N children that touch each other to share an
 * internal separator line. Use for related actions on the same row
 * (Save / Save & New / overflow ellipsis) or compact view-mode toggles.
 *
 * `ButtonGroup` is for *related actions* (each does something different).
 * For mutually-exclusive selection states (only one selected at a time)
 * use `SegmentedControl` instead.
 *
 * The wrapper takes a `size` (2xs / sm / default) that controls the outer
 * radius per Figma — `2xs` = `rounded-sm` (Figma 2X-Small 24, radius 6),
 * `sm` and `default` = `rounded-md` (Figma X-Small 32 + Small 36, radius 8).
 * Same-row sizing convention from `packages/ui/AGENTS.md` still applies:
 * every child Button / IconButton inside the group MUST share the same
 * `size` prop as the group itself.
 *
 * Visual joining is handled at the wrapper level via descendant CSS
 * selectors — children render normally, the wrapper strips their own
 * corners, shadow, and outer borders, and adds an internal separator
 * (`border-r` / `border-b`) between siblings. This way no `cloneElement`
 * is required and any element that accepts a `className` (Button,
 * IconButton, LinkButton, asChild wrappers, etc.) can be a group member.
 *
 * ```tsx
 * <ButtonGroup>
 *   <Button>Save</Button>
 *   <Button>Save & New</Button>
 *   <IconButton aria-label="More"><MoreHorizontal /></IconButton>
 * </ButtonGroup>
 *
 * <ButtonGroup orientation="vertical" size="sm">
 *   <Button variant="outline">Up</Button>
 *   <Button variant="outline">Down</Button>
 * </ButtonGroup>
 * ```
 */
const buttonGroupVariants = cva(
  // Outer chrome: rounded shell + border + clipped corners + shared shadow.
  // Descendant rules collapse children into segments:
  //   * strip own corners / shadow / outer border on every child
  //   * raise focus-visible above neighbours so the focus ring is not clipped
  //   * separator: border-r (horizontal) or border-b (vertical) on every
  //     child except the last one
  'inline-flex w-fit border border-input bg-background shadow-xs overflow-hidden ' +
    "[&>*]:rounded-none [&>*]:shadow-none [&>*]:border-0 " +
    "[&>*]:focus-visible:relative [&>*]:focus-visible:z-10 " +
    'disabled:opacity-50',
  {
    variants: {
      orientation: {
        horizontal:
          'flex-row [&>*:not(:last-child)]:border-r [&>*:not(:last-child)]:border-input',
        vertical:
          'flex-col [&>*:not(:last-child)]:border-b [&>*:not(:last-child)]:border-input',
      },
      size: {
        // Figma `2X-Small (24)` → cornerRadius 6 → DS `rounded-sm` (6px).
        '2xs': 'rounded-sm',
        // Figma `X-Small (32)` → cornerRadius 8 → DS `rounded-md` (8px).
        sm: 'rounded-md',
        // Figma `Small (36)` → cornerRadius 8 → DS `rounded-md` (8px).
        default: 'rounded-md',
      },
    },
    defaultVariants: {
      orientation: 'horizontal',
      size: 'default',
    },
  },
)

export type ButtonGroupProps = React.HTMLAttributes<HTMLDivElement> &
  VariantProps<typeof buttonGroupVariants> & {
    /** Forwarded to the wrapper's `aria-label` for screen-reader context. */
    'aria-label'?: string
  }

export const ButtonGroup = React.forwardRef<HTMLDivElement, ButtonGroupProps>(
  ({ className, orientation, size, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="button-group"
      role="group"
      className={cn(buttonGroupVariants({ orientation, size }), className)}
      {...props}
    />
  ),
)
ButtonGroup.displayName = 'ButtonGroup'

export { buttonGroupVariants }
