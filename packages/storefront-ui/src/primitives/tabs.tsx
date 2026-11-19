'use client'

import * as React from 'react'
import { cn } from '../lib/cn'

type Variant = 'underline' | 'pill' | 'segmented'

type TabsContextValue = {
  value: string
  setValue: (value: string) => void
  baseId: string
  variant: Variant
}

const TabsContext = React.createContext<TabsContextValue | null>(null)

function useTabs(component: string) {
  const context = React.useContext(TabsContext)
  if (!context) throw new Error(`[internal] ${component} must be used inside Tabs`)
  return context
}

export type TabsProps = Omit<React.ComponentPropsWithoutRef<'div'>, 'defaultValue' | 'onChange'> & {
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
  variant?: Variant
}

/**
 * Tabs implemented without Radix (`@radix-ui/react-tabs` is not in the allowed dependency
 * list). WAI-ARIA tabs pattern: roving tabindex, arrow keys, Home/End, automatic activation.
 */
const TabsRoot = React.forwardRef<HTMLDivElement, TabsProps>(function Tabs(
  { value: valueProp, defaultValue, onValueChange, variant = 'underline', className, ...props },
  ref,
) {
  const [uncontrolled, setUncontrolled] = React.useState(defaultValue ?? '')
  const value = valueProp ?? uncontrolled
  const setValue = React.useCallback(
    (next: string) => {
      if (valueProp === undefined) setUncontrolled(next)
      onValueChange?.(next)
    },
    [valueProp, onValueChange],
  )
  const baseId = React.useId()
  const context = React.useMemo(() => ({ value, setValue, baseId, variant }), [value, setValue, baseId, variant])
  return (
    <TabsContext.Provider value={context}>
      <div ref={ref} data-slot="tabs" data-variant={variant} className={cn('flex flex-col gap-4', className)} {...props} />
    </TabsContext.Provider>
  )
})

const listClass: Record<Variant, string> = {
  underline: 'flex gap-6 overflow-x-auto border-b border-border [scrollbar-width:none]',
  pill: 'flex gap-2 overflow-x-auto [scrollbar-width:none]',
  segmented: 'inline-flex gap-0.5 rounded-sf-button bg-muted p-1',
}

const TabsList = React.forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<'div'>>(function TabsList(
  { className, onKeyDown, ...props },
  ref,
) {
  const { variant, setValue } = useTabs('Tabs.List')
  return (
    <div
      ref={ref}
      role="tablist"
      data-slot="tabs-list"
      className={cn(listClass[variant], className)}
      onKeyDown={(event) => {
        onKeyDown?.(event)
        if (event.defaultPrevented) return
        const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]:not([disabled])'))
        const index = tabs.indexOf(document.activeElement as HTMLButtonElement)
        if (index === -1) return
        const moves: Record<string, number> = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: tabs.length - 1 }
        if (!(event.key in moves)) return
        event.preventDefault()
        const next = tabs[(moves[event.key] + tabs.length) % tabs.length]
        next.focus()
        const value = next.dataset.value
        if (value) setValue(value)
      }}
      {...props}
    />
  )
})

const triggerClass: Record<Variant, string> = {
  underline: '-mb-px border-b-2 border-transparent px-0.5 py-3 text-sf-body-sm text-muted-foreground hover:text-foreground aria-selected:border-foreground aria-selected:text-foreground',
  pill: 'rounded-sf-chip border border-border px-4 py-2.5 text-sf-body-sm text-foreground hover:bg-muted aria-selected:border-primary aria-selected:bg-primary aria-selected:text-primary-foreground',
  segmented: 'rounded-sf-badge px-4 py-2 text-sf-body-sm text-muted-foreground hover:text-foreground aria-selected:bg-background aria-selected:text-foreground aria-selected:shadow-xs',
}

export type TabsTriggerProps = React.ComponentPropsWithoutRef<'button'> & {
  value: string
  /** Count or badge rendered after the label. */
  trailing?: React.ReactNode
}

const TabsTrigger = React.forwardRef<HTMLButtonElement, TabsTriggerProps>(function TabsTrigger(
  { value, trailing, className, children, onClick, ...props },
  ref,
) {
  const context = useTabs('Tabs.Trigger')
  const selected = context.value === value
  return (
    <button
      ref={ref}
      type="button"
      role="tab"
      id={`${context.baseId}-tab-${value}`}
      aria-selected={selected}
      aria-controls={`${context.baseId}-panel-${value}`}
      tabIndex={selected ? 0 : -1}
      data-slot="tabs-trigger"
      data-value={value}
      data-state={selected ? 'active' : 'inactive'}
      className={cn(
        'inline-flex shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap sf-label-case outline-none transition-colors focus-visible:shadow-focus disabled:cursor-not-allowed disabled:text-text-disabled',
        triggerClass[context.variant],
        className,
      )}
      onClick={(event) => { onClick?.(event); if (!event.defaultPrevented) context.setValue(value) }}
      {...props}
    >
      {children}
      {trailing ? <span className="text-sf-body-xs font-normal opacity-80">{trailing}</span> : null}
    </button>
  )
})

export type TabsContentProps = React.ComponentPropsWithoutRef<'div'> & { value: string; forceMount?: boolean }

const TabsContent = React.forwardRef<HTMLDivElement, TabsContentProps>(function TabsContent(
  { value, forceMount, className, ...props },
  ref,
) {
  const context = useTabs('Tabs.Content')
  const selected = context.value === value
  if (!selected && !forceMount) return null
  return (
    <div
      ref={ref}
      role="tabpanel"
      id={`${context.baseId}-panel-${value}`}
      aria-labelledby={`${context.baseId}-tab-${value}`}
      hidden={!selected}
      tabIndex={0}
      data-slot="tabs-content"
      className={cn('outline-none focus-visible:shadow-focus', className)}
      {...props}
    />
  )
})

export const Tabs = Object.assign(TabsRoot, { List: TabsList, Trigger: TabsTrigger, Content: TabsContent })
