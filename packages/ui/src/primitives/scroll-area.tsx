"use client"

import * as React from 'react'
import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area'

import { cn } from '@open-mercato/shared/lib/utils'

/**
 * DS-styled scrollable container. Wraps Radix `ScrollArea` with token-driven
 * thumb / track styling that matches the rest of the design system instead of
 * native OS scrollbars (which render inconsistently across macOS / Windows /
 * Linux).
 *
 * Figma Scroll [1.1] (`166941:61889`) provides Default/Lighter tracks in
 * 20/16/12px widths with a 4px thumb. Explicit scrollbarSize/scrollbarVariant
 * opt into those styles; omitted props preserve the existing 10px track.
 *
 * Usage — primary single-element form:
 *
 * ```tsx
 * <ScrollArea className="h-72">
 *   <div className="p-4">{children}</div>
 * </ScrollArea>
 * ```
 *
 * For advanced layouts that need separate access to the `Viewport`,
 * `Scrollbar`, or `Corner`, use the compound API directly:
 *
 * ```tsx
 * <ScrollAreaRoot className="h-72">
 *   <ScrollAreaViewport>{children}</ScrollAreaViewport>
 *   <ScrollAreaScrollbar orientation="vertical">
 *     <ScrollAreaThumb />
 *   </ScrollAreaScrollbar>
 *   <ScrollAreaCorner />
 * </ScrollAreaRoot>
 * ```
 */

const ScrollAreaRoot = React.forwardRef<
  React.ElementRef<typeof ScrollAreaPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Root>
>(({ className, ...props }, ref) => (
  <ScrollAreaPrimitive.Root
    ref={ref}
    data-slot="scroll-area-root"
    className={cn('relative overflow-hidden', className)}
    {...props}
  />
))
ScrollAreaRoot.displayName = ScrollAreaPrimitive.Root.displayName

const ScrollAreaViewport = React.forwardRef<
  React.ElementRef<typeof ScrollAreaPrimitive.Viewport>,
  React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Viewport>
>(({ className, ...props }, ref) => (
  <ScrollAreaPrimitive.Viewport
    ref={ref}
    data-slot="scroll-area-viewport"
    className={cn('h-full w-full rounded-[inherit]', className)}
    {...props}
  />
))
ScrollAreaViewport.displayName = ScrollAreaPrimitive.Viewport.displayName

type ScrollbarSize = 'md' | 'sm' | 'xs'
type ScrollbarVariant = 'default' | 'lighter'

const ScrollbarStyleContext = React.createContext<{ variant?: ScrollbarVariant; orientation?: 'vertical' | 'horizontal' }>({})

type ScrollAreaScrollbarProps = React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar> & {
  size?: ScrollbarSize
  variant?: ScrollbarVariant
}

const ScrollAreaScrollbar = React.forwardRef<
  React.ElementRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>,
  ScrollAreaScrollbarProps
>(({ className, orientation = 'vertical', size, variant, children, ...props }, ref) => {
  const styled = size !== undefined || variant !== undefined
  const resolvedSize = size ?? 'md'
  const resolvedVariant = styled ? variant ?? 'default' : undefined
  return (
    <ScrollbarStyleContext.Provider value={{ variant: resolvedVariant, orientation }}>
      <ScrollAreaPrimitive.ScrollAreaScrollbar
        ref={ref}
        orientation={orientation}
        data-slot="scroll-area-scrollbar"
        className={cn(
          'flex touch-none select-none transition-colors',
          !styled && orientation === 'vertical' && 'h-full w-2.5 border-l border-l-transparent p-px',
          !styled && orientation === 'horizontal' && 'h-2.5 w-full border-t border-t-transparent p-px',
          styled && 'justify-center border-border',
          styled && (resolvedVariant === 'lighter' ? 'bg-muted' : 'bg-background'),
          styled && orientation === 'vertical' && 'h-full border-l py-2',
          styled && orientation === 'horizontal' && 'w-full flex-col border-t px-2',
          styled && orientation === 'vertical' && { md: 'w-5', sm: 'w-4', xs: 'w-3' }[resolvedSize],
          styled && orientation === 'horizontal' && { md: 'h-5', sm: 'h-4', xs: 'h-3' }[resolvedSize],
          className,
        )}
        {...props}
      >
        {children}
      </ScrollAreaPrimitive.ScrollAreaScrollbar>
    </ScrollbarStyleContext.Provider>
  )
})
ScrollAreaScrollbar.displayName = ScrollAreaPrimitive.ScrollAreaScrollbar.displayName

const ScrollAreaThumb = React.forwardRef<
  React.ElementRef<typeof ScrollAreaPrimitive.ScrollAreaThumb>,
  React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.ScrollAreaThumb>
>(({ className, ...props }, ref) => {
  const { variant, orientation } = React.useContext(ScrollbarStyleContext)
  return (
    <ScrollAreaPrimitive.ScrollAreaThumb
      ref={ref}
      data-slot="scroll-area-thumb"
      className={cn(
        'relative rounded-full transition-colors hover:bg-muted-foreground/50',
        variant ? 'flex-none' : 'flex-1',
        variant === 'default' ? 'bg-border' : 'bg-muted-foreground/30',
        variant && (orientation === 'horizontal' ? 'h-1 min-h-1' : 'w-1 min-w-1'),
        className,
      )}
      {...props}
    />
  )
})
ScrollAreaThumb.displayName = ScrollAreaPrimitive.ScrollAreaThumb.displayName

const ScrollAreaCorner = React.forwardRef<
  React.ElementRef<typeof ScrollAreaPrimitive.Corner>,
  React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Corner>
>(({ className, ...props }, ref) => (
  <ScrollAreaPrimitive.Corner
    ref={ref}
    data-slot="scroll-area-corner"
    className={cn('bg-transparent', className)}
    {...props}
  />
))
ScrollAreaCorner.displayName = ScrollAreaPrimitive.Corner.displayName

type ScrollAreaProps = React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Root> & {
  /**
   * Which scrollbars to render. Defaults to `'vertical'` — the most common
   * case. Use `'both'` for two-axis scroll (e.g. wide table preview) or
   * `'horizontal'` for a horizontal-only carousel.
   */
  scrollbars?: 'vertical' | 'horizontal' | 'both'
  /** Optional className applied to the inner `Viewport`. */
  viewportClassName?: string
  /** Optional className applied to every `Scrollbar`. */
  scrollbarClassName?: string
  /** Optional className applied to every `Thumb`. */
  thumbClassName?: string
  scrollbarSize?: ScrollbarSize
  scrollbarVariant?: ScrollbarVariant
}

/**
 * Convenience wrapper that composes Root + Viewport + one or two Scrollbars +
 * Corner in a single element. Reach for `ScrollAreaRoot` + sub-components
 * directly when the wrapper's defaults don't fit (e.g. you need conditional
 * scrollbar rendering or a custom viewport).
 */
const ScrollArea = React.forwardRef<
  React.ElementRef<typeof ScrollAreaPrimitive.Root>,
  ScrollAreaProps
>(
  (
    { children, className, scrollbars = 'vertical', viewportClassName, scrollbarClassName, thumbClassName, scrollbarSize, scrollbarVariant, ...props },
    ref,
  ) => (
    <ScrollAreaRoot ref={ref} className={className} {...props}>
      <ScrollAreaViewport className={viewportClassName}>{children}</ScrollAreaViewport>
      {(scrollbars === 'vertical' || scrollbars === 'both') ? (
        <ScrollAreaScrollbar orientation="vertical" size={scrollbarSize} variant={scrollbarVariant} className={scrollbarClassName}>
          <ScrollAreaThumb className={thumbClassName} />
        </ScrollAreaScrollbar>
      ) : null}
      {(scrollbars === 'horizontal' || scrollbars === 'both') ? (
        <ScrollAreaScrollbar orientation="horizontal" size={scrollbarSize} variant={scrollbarVariant} className={scrollbarClassName}>
          <ScrollAreaThumb className={thumbClassName} />
        </ScrollAreaScrollbar>
      ) : null}
      <ScrollAreaCorner />
    </ScrollAreaRoot>
  ),
)
ScrollArea.displayName = 'ScrollArea'

export {
  ScrollArea,
  ScrollAreaRoot,
  ScrollAreaViewport,
  ScrollAreaScrollbar,
  ScrollAreaThumb,
  ScrollAreaCorner,
}
