"use client"

import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'

import { cn } from '@open-mercato/shared/lib/utils'

/**
 * Scopes design tokens to a part of the page, like a configuration provider:
 * colour mode, density, shape (corner radius roles) and text direction.
 * Everything inside reads the same tokens, so primitives and blocks follow
 * without extra props. Scopes nest; the closest one wins.
 *
 * ```tsx
 * <DesignScope mode="dark" density="compact" shape="round">
 *   <InspectorPanel />
 * </DesignScope>
 * ```
 *
 * Overlays rendered in a portal (Select, Popover, Dialog) mount at the end
 * of the document and follow the page scope, not this one.
 */

export type DesignScopeMode = 'light' | 'dark'
export type DesignScopeDensity = 'default' | 'compact'
export type DesignScopeShape = 'default' | 'round' | 'sharp'
export type DesignScopeRadius = Partial<Record<'button' | 'field' | 'card' | 'badge', string>>

export type DesignScopeValue = {
  mode?: DesignScopeMode
  density: DesignScopeDensity
  shape: DesignScopeShape
  dir?: 'ltr' | 'rtl'
}

export type DesignScopeProps = Omit<React.HTMLAttributes<HTMLDivElement>, 'dir'> & {
  mode?: DesignScopeMode
  density?: DesignScopeDensity
  shape?: DesignScopeShape
  radius?: DesignScopeRadius
  dir?: 'ltr' | 'rtl'
  asChild?: boolean
}

const SHAPE_RADIUS: Record<DesignScopeShape, DesignScopeRadius> = {
  default: {},
  round: { button: '9999px', field: '0.75rem', card: '1.5rem' },
  sharp: { button: '0.25rem', field: '0.25rem', card: '0.25rem', badge: '0.25rem' },
}

const RADIUS_VALUE = /^(?:0|\d+(?:\.\d+)?(?:px|rem|em|%))$/

const DesignScopeContext = React.createContext<DesignScopeValue>({ density: 'default', shape: 'default' })

export function useDesignScope(): DesignScopeValue {
  return React.useContext(DesignScopeContext)
}

export function designScopeRadiusStyle(shape: DesignScopeShape, radius?: DesignScopeRadius): React.CSSProperties | undefined {
  const merged = { ...SHAPE_RADIUS[shape], ...radius }
  const entries = Object.entries(merged).filter(([, value]) => typeof value === 'string' && RADIUS_VALUE.test(value))
  if (entries.length === 0) return undefined
  return Object.fromEntries(entries.map(([role, value]) => [`--om-radius-${role}`, value])) as React.CSSProperties
}

export function DesignScope({
  mode,
  density,
  shape,
  radius,
  dir,
  asChild = false,
  className,
  style,
  children,
  ...props
}: DesignScopeProps) {
  const parent = useDesignScope()
  const resolvedDensity = density ?? parent.density
  const resolvedShape = shape ?? parent.shape
  const value = React.useMemo<DesignScopeValue>(
    () => ({ mode: mode ?? parent.mode, density: resolvedDensity, shape: resolvedShape, dir: dir ?? parent.dir }),
    [mode, parent.mode, resolvedDensity, resolvedShape, dir, parent.dir],
  )
  const radiusStyle = shape || radius ? designScopeRadiusStyle(resolvedShape, radius) : undefined
  const Component = asChild ? Slot : 'div'

  return (
    <DesignScopeContext.Provider value={value}>
      <Component
        data-slot="design-scope"
        data-density={density}
        data-mode={mode}
        dir={dir}
        className={cn(mode && [mode, 'bg-background text-foreground'], className)}
        style={radiusStyle || style ? { ...radiusStyle, ...style } : undefined}
        {...props}
      >
        {children}
      </Component>
    </DesignScopeContext.Provider>
  )
}
