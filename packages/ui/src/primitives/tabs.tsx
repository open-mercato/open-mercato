'use client'

import * as React from 'react'
import { createContext, useContext } from 'react'

import { cn } from '@open-mercato/shared/lib/utils'
import { Button } from './button'

/**
 * Tab navigation primitive — backward compatible with the original
 * pill-style API. Phase B.5 rewrite adds the Figma underline variant
 * (`Tab Menu Horizontal [1.1]` in `553:734`), the vertical orientation
 * (`Tab Menu Vertical [1.1]`), and per-tab `leading` icon + `count`
 * badge slots.
 *
 * Backward compatibility (6 import sites):
 *   integrations/[id]/page.tsx
 *   scheduler JobLogsModal.tsx
 *   checkout LinkTemplateForm.tsx
 *   search VectorSearchSection.tsx + FulltextSearchSection.tsx
 *   ai-assistant AiPlaygroundPageClient.tsx
 *
 * All six call `<Tabs>` + `<TabsList>` + `<TabsTrigger>` +
 * `<TabsContent>` with the default pill look. The default `variant`
 * stays `pill` so they keep rendering verbatim.
 */

type TabsContextValue = {
  value: string
  onValueChange: (value: string) => void
  variant: 'pill' | 'underline'
  orientation: 'horizontal' | 'vertical'
}

export const TabsContext = createContext<TabsContextValue | undefined>(undefined)

export function useTabsContext() {
  const context = useContext(TabsContext)
  if (!context) {
    throw new Error('Tabs components must be used within a Tabs provider')
  }
  return context
}

export type TabsVariant = 'pill' | 'underline'
export type TabsOrientation = 'horizontal' | 'vertical'

export type TabsProps = {
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
  /** Visual style. `pill` is the original look (bg-muted container,
   * bg-background selected pill). `underline` matches Figma `Tab Menu
   * Horizontal [1.1]` — flat strip with a thin border-bottom and an
   * accent-indigo underline on the active tab. */
  variant?: TabsVariant
  /** Tab strip orientation. `horizontal` lays the strip in a row;
   * `vertical` lays it in a column. The default `pill` variant
   * supports both; the underline variant supports only `horizontal`
   * (per Figma — vertical underline is not a documented pattern). */
  orientation?: TabsOrientation
  children: React.ReactNode
  className?: string
}

export function Tabs({
  value: controlledValue,
  defaultValue,
  onValueChange,
  variant = 'pill',
  orientation = 'horizontal',
  children,
  className,
}: TabsProps) {
  const [uncontrolledValue, setUncontrolledValue] = React.useState(defaultValue ?? '')
  const isControlled = controlledValue !== undefined
  const value = isControlled ? controlledValue : uncontrolledValue

  const handleValueChange = React.useCallback(
    (newValue: string) => {
      if (!isControlled) {
        setUncontrolledValue(newValue)
      }
      onValueChange?.(newValue)
    },
    [isControlled, onValueChange],
  )

  const contextValue = React.useMemo<TabsContextValue>(
    () => ({ value, onValueChange: handleValueChange, variant, orientation }),
    [value, handleValueChange, variant, orientation],
  )

  return (
    <TabsContext.Provider value={contextValue}>
      <div
        data-slot="tabs"
        data-variant={variant}
        data-orientation={orientation}
        className={cn(orientation === 'vertical' ? 'flex gap-4' : '', className)}
      >
        {children}
      </div>
    </TabsContext.Provider>
  )
}

export type TabsListProps = {
  children: React.ReactNode
  className?: string
}

export function TabsList({ children, className }: TabsListProps) {
  const { variant, orientation } = useTabsContext()

  const baseClasses =
    variant === 'underline'
      ? // Underline strip — flat, full-width border-bottom for the rail,
        // selected trigger gets its own border-b-2 accent below.
        orientation === 'vertical'
          ? 'inline-flex flex-col items-stretch gap-1 border-r border-input pr-3'
          : 'inline-flex h-10 items-center justify-start gap-4 border-b border-input text-muted-foreground'
      : // Pill strip (original) — rounded container, bg-muted shell.
        orientation === 'vertical'
        ? 'inline-flex flex-col items-stretch gap-1 rounded-lg bg-muted p-1 text-muted-foreground'
        : 'inline-flex h-9 items-center justify-start gap-1 rounded-lg bg-muted p-1 text-muted-foreground'

  return (
    <div
      data-slot="tabs-list"
      className={cn(baseClasses, className)}
      role="tablist"
      aria-orientation={orientation}
    >
      {children}
    </div>
  )
}

export type TabsTriggerProps = {
  value: string
  children: React.ReactNode
  className?: string
  disabled?: boolean
  /** Optional leading icon slot — typically a lucide-react icon at
   * `size-4`. Per Figma `Tab Menu Horizontal Items [1.1]`. */
  leading?: React.ReactNode
  /** Optional trailing count badge — typically a numeric count or
   * "New". Rendered as a muted pill that highlights to indigo when
   * the tab is selected. */
  count?: React.ReactNode
}

export function TabsTrigger({
  value,
  children,
  className,
  disabled,
  leading,
  count,
}: TabsTriggerProps) {
  const { value: selectedValue, onValueChange, variant, orientation } = useTabsContext()
  const isSelected = selectedValue === value

  if (variant === 'underline') {
    return (
      <button
        type="button"
        role="tab"
        aria-selected={isSelected}
        disabled={disabled}
        onClick={() => onValueChange(value)}
        data-slot="tabs-trigger"
        data-state={isSelected ? 'active' : 'inactive'}
        data-variant="underline"
        className={cn(
          // Underline trigger — flat, bottom-border accent when active.
          // Negative margin-bottom -1px so the active accent sits on
          // top of the rail's border-bottom (rather than below it).
          // Hover fills a subtle violet background wash (+ violet text and icon),
          // token-driven so it holds in light and dark. The selected tab still
          // owns the solid accent-indigo underline, so the filled hover never gets
          // confused with the active state.
          orientation === 'vertical'
            ? 'group relative inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground outline-none transition-colors hover:bg-accent-indigo/10 hover:text-accent-indigo'
            : 'group relative -mb-px inline-flex items-center gap-2 rounded-t-md border-b-2 border-transparent px-3 py-2 text-sm font-medium text-muted-foreground outline-none transition-colors hover:bg-accent-indigo/10 hover:text-accent-indigo',
          'focus-visible:shadow-focus',
          'disabled:pointer-events-none disabled:opacity-50',
          isSelected
            ? orientation === 'vertical'
              ? 'bg-muted/40 text-foreground hover:bg-muted/40 hover:text-foreground'
              : 'border-accent-indigo font-semibold text-foreground hover:border-accent-indigo hover:bg-transparent hover:text-foreground'
            : '',
          className,
        )}
      >
        {leading ? (
          <span
            data-slot="tabs-trigger-leading"
            aria-hidden="true"
            className={cn(
              'inline-flex shrink-0 items-center justify-center',
              isSelected ? 'text-accent-indigo' : 'text-muted-foreground group-hover:text-accent-indigo',
            )}
          >
            {leading}
          </span>
        ) : null}
        <span className="min-w-0 truncate">{children}</span>
        {count !== undefined ? (
          <span
            data-slot="tabs-trigger-count"
            className={cn(
              'inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 text-xs font-medium',
              isSelected
                ? 'bg-accent-indigo/10 text-accent-indigo'
                : 'bg-muted text-muted-foreground',
            )}
          >
            {count}
          </span>
        ) : null}
      </button>
    )
  }

  // Pill variant (original look) — `<Button variant="ghost" size="sm">`
  // with state classes. Backward compatible.
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      role="tab"
      aria-selected={isSelected}
      disabled={disabled}
      onClick={() => onValueChange(value)}
      data-slot="tabs-trigger"
      data-state={isSelected ? 'active' : 'inactive'}
      data-variant="pill"
      className={cn(
        'gap-2',
        isSelected
          ? 'bg-background text-foreground shadow'
          : 'hover:bg-background/80 hover:text-foreground',
        className,
      )}
    >
      {leading ? (
        <span
          data-slot="tabs-trigger-leading"
          aria-hidden="true"
          className="inline-flex shrink-0 items-center justify-center"
        >
          {leading}
        </span>
      ) : null}
      <span>{children}</span>
      {count !== undefined ? (
        <span
          data-slot="tabs-trigger-count"
          className={cn(
            'inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 text-xs font-medium',
            isSelected
              ? 'bg-accent-indigo/10 text-accent-indigo'
              : 'bg-background/60 text-muted-foreground',
          )}
        >
          {count}
        </span>
      ) : null}
    </Button>
  )
}

export type TabsContentProps = {
  value: string
  children: React.ReactNode
  className?: string
}

export function TabsContent({ value, children, className }: TabsContentProps) {
  const { value: selectedValue, orientation } = useTabsContext()

  if (selectedValue !== value) {
    return null
  }

  return (
    <div
      role="tabpanel"
      data-slot="tabs-content"
      className={cn(
        orientation === 'vertical' ? 'flex-1 min-w-0' : 'mt-2',
        'ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        className,
      )}
    >
      {children}
    </div>
  )
}
