"use client"

import * as React from 'react'
import * as AccordionPrimitive from '@radix-ui/react-accordion'
import { ChevronDown, Minus, Plus } from 'lucide-react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@open-mercato/shared/lib/utils'

export type AccordionTriggerIcon = 'plus-minus' | 'chevron' | 'none'
export type AccordionIconPosition = 'end' | 'start'

const accordionItemVariants = cva(
  // `--accordion-indent` defaults to the container padding (14px). The
  // `has-[…trigger-left-icon]` Tailwind v4 variant promotes it to 44px
  // (icon 20 + gap 10 + container padding 14) whenever an `AccordionTrigger`
  // declares a `leftIcon`, so `AccordionContent` aligns with the title text
  // — matches Figma 210:4064 (Active state) without React state or hydration
  // flash.
  'overflow-hidden rounded-[10px] transition-colors [--accordion-indent:14px] has-[[data-slot=accordion-trigger-left-icon]]:[--accordion-indent:44px]',
  {
    variants: {
      variant: {
        // Figma 210:4021 (Default), 210:4048 (Hover), 210:4064 (Active):
        // closed = white card + soft border + x-small shadow,
        // hover (closed) = weak-50 bg, no border, no shadow,
        // open = weak-50 bg, no border, no shadow.
        card:
          'border border-border bg-card shadow-xs ' +
          'data-[state=open]:border-transparent data-[state=open]:bg-muted data-[state=open]:shadow-none ' +
          'data-[state=closed]:hover:border-transparent data-[state=closed]:hover:bg-muted data-[state=closed]:hover:shadow-none',
        // For embedded use cases (e.g. FAQ block on a coloured surface or
        // borderless nav-style list where the surrounding container owns
        // the visual chrome).
        borderless: 'border-transparent bg-transparent shadow-none',
      },
    },
    defaultVariants: { variant: 'card' },
  },
)

const Accordion = AccordionPrimitive.Root

type AccordionItemProps = React.ComponentPropsWithoutRef<typeof AccordionPrimitive.Item> &
  VariantProps<typeof accordionItemVariants>

const AccordionItem = React.forwardRef<
  React.ElementRef<typeof AccordionPrimitive.Item>,
  AccordionItemProps
>(({ className, variant, ...props }, ref) => (
  <AccordionPrimitive.Item
    ref={ref}
    data-slot="accordion-item"
    className={cn(accordionItemVariants({ variant }), className)}
    {...props}
  />
))
AccordionItem.displayName = 'AccordionItem'

const AccordionHeader = React.forwardRef<
  React.ElementRef<typeof AccordionPrimitive.Header>,
  React.ComponentPropsWithoutRef<typeof AccordionPrimitive.Header>
>(({ className, ...props }, ref) => (
  <AccordionPrimitive.Header
    ref={ref}
    data-slot="accordion-header"
    className={cn('flex', className)}
    {...props}
  />
))
AccordionHeader.displayName = 'AccordionHeader'

type AccordionTriggerProps = React.ComponentPropsWithoutRef<typeof AccordionPrimitive.Trigger> & {
  /**
   * Leading icon (Figma 210:4017 `question-line` slot). Renders as a
   * 20×20 decorative glyph before the label. Pass any Lucide icon or
   * custom element; omit to skip the slot.
   *
   * When present and `iconPosition="end"`, the parent `AccordionItem`
   * auto-promotes `AccordionContent`'s horizontal padding to 44px so the
   * description aligns with the title text.
   */
  leftIcon?: React.ReactNode
  /**
   * Trailing indicator style. Figma reference uses `'plus-minus'`
   * (add-line / subtract-line) — the default. `'chevron'` swaps in a
   * rotating ChevronDown for shadcn-style consumers. `'none'` disables
   * the indicator entirely (useful when `indicator` carries the visual).
   */
  triggerIcon?: AccordionTriggerIcon
  /**
   * Where the open/close indicator sits. `'end'` (default) puts it on
   * the trailing edge per Figma `Flip Icon = Off`; `'start'` mirrors the
   * Figma `Flip Icon = On` variant. With `'start'`, `leftIcon` is
   * intentionally suppressed because the indicator already occupies the
   * leading slot — pass any decorative glyph as the indicator itself.
   */
  iconPosition?: AccordionIconPosition
  /**
   * Custom indicator override. When provided, replaces the
   * `triggerIcon` plus/chevron node entirely — useful for status
   * badges, step numbers, or progress dots.
   */
  indicator?: React.ReactNode
  /**
   * Extra className applied to the internal `AccordionPrimitive.Header`
   * (`<h3>`) wrapper. Use this when the trigger row needs to share its
   * line with sibling action buttons (e.g. a kebab menu next to the
   * Accordion list of settings rows) — the header can then take
   * `flex-1` while the sibling stays its natural size.
   */
  headerClassName?: string
}

const AccordionTrigger = React.forwardRef<
  React.ElementRef<typeof AccordionPrimitive.Trigger>,
  AccordionTriggerProps
>(
  (
    {
      className,
      leftIcon,
      triggerIcon = 'plus-minus',
      iconPosition = 'end',
      indicator,
      headerClassName,
      children,
      ...props
    },
    ref,
  ) => {
    const indicatorNode =
      indicator !== undefined
        ? indicator
        : triggerIcon === 'chevron'
          ? <ChevronDown className="size-5 transition-transform duration-200 group-data-[state=open]/accordion-trigger:rotate-180" aria-hidden="true" />
          : triggerIcon === 'plus-minus'
            ? (
              <>
                <Plus className="size-5 group-data-[state=open]/accordion-trigger:hidden" aria-hidden="true" />
                <Minus className="hidden size-5 group-data-[state=open]/accordion-trigger:block" aria-hidden="true" />
              </>
            )
            : null

    const renderLeftIcon = Boolean(leftIcon) && iconPosition === 'end'

    return (
      <AccordionPrimitive.Header className={cn('flex', headerClassName)} data-slot="accordion-header">
        <AccordionPrimitive.Trigger
          ref={ref}
          data-slot="accordion-trigger"
          className={cn(
            'group/accordion-trigger flex w-full items-start gap-2.5 p-3.5 text-left text-sm font-medium leading-5 tracking-tight text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-50',
            className,
          )}
          {...props}
        >
          {iconPosition === 'start' && indicatorNode ? (
            <span
              className="inline-flex size-5 shrink-0 items-center justify-center text-foreground"
              data-slot="accordion-trigger-indicator"
              aria-hidden="true"
            >
              {indicatorNode}
            </span>
          ) : null}
          {renderLeftIcon ? (
            <span
              className="inline-flex size-5 shrink-0 items-center justify-center text-muted-foreground [&>svg]:size-5"
              data-slot="accordion-trigger-left-icon"
              aria-hidden="true"
            >
              {leftIcon}
            </span>
          ) : null}
          <span className="min-w-0 flex-1 self-center" data-slot="accordion-trigger-label">
            {children}
          </span>
          {iconPosition === 'end' && indicatorNode ? (
            <span
              className="inline-flex size-5 shrink-0 items-center justify-center text-foreground"
              data-slot="accordion-trigger-indicator"
              aria-hidden="true"
            >
              {indicatorNode}
            </span>
          ) : null}
        </AccordionPrimitive.Trigger>
      </AccordionPrimitive.Header>
    )
  },
)
AccordionTrigger.displayName = 'AccordionTrigger'

type AccordionContentProps = React.ComponentPropsWithoutRef<typeof AccordionPrimitive.Content>

const AccordionContent = React.forwardRef<
  React.ElementRef<typeof AccordionPrimitive.Content>,
  AccordionContentProps
>(({ className, children, ...props }, ref) => (
  <AccordionPrimitive.Content
    ref={ref}
    data-slot="accordion-content"
    className={cn(
      'overflow-hidden text-sm leading-5 text-muted-foreground data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down',
      className,
    )}
    {...props}
  >
    <div className="pb-3.5 pt-0 pl-[var(--accordion-indent)] pr-[var(--accordion-indent)]">
      {children}
    </div>
  </AccordionPrimitive.Content>
))
AccordionContent.displayName = 'AccordionContent'

export {
  Accordion,
  AccordionItem,
  AccordionHeader,
  AccordionTrigger,
  AccordionContent,
  accordionItemVariants,
}
