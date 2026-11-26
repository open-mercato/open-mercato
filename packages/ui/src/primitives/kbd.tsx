"use client"

import * as React from 'react'
import { cn } from '@open-mercato/shared/lib/utils'

export const MOD_KEY = 'Mod'

const APPLE_PLATFORM_PATTERN = /mac|iphone|ipad|ipod/i

type NavigatorWithUserAgentData = Navigator & { userAgentData?: { platform?: string } }

export function isApplePlatform(): boolean {
  if (typeof navigator === 'undefined') return false
  const nav = navigator as NavigatorWithUserAgentData
  const platform = nav.userAgentData?.platform || nav.platform || nav.userAgent || ''
  return APPLE_PLATFORM_PATTERN.test(platform)
}

function subscribeToPlatform(): () => void {
  return () => {}
}

function getServerPlatformSnapshot(): boolean {
  return false
}

export function useIsApplePlatform(): boolean {
  return React.useSyncExternalStore(subscribeToPlatform, isApplePlatform, getServerPlatformSnapshot)
}

export function useModifierKeyLabel(): string {
  return useIsApplePlatform() ? '⌘' : 'Ctrl'
}

export type KbdProps = React.HTMLAttributes<HTMLElement>

export function Kbd({ children, className, ...props }: KbdProps) {
  return (
    <kbd
      className={cn(
        'inline-flex items-center rounded-sm border border-border bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground shadow-xs',
        className,
      )}
      {...props}
    >
      {children}
    </kbd>
  )
}

export type KbdShortcutProps = {
  keys: string[]
  className?: string
}

export function KbdShortcut({ keys, className }: KbdShortcutProps) {
  const modifierKey = useModifierKeyLabel()
  return (
    <span className={cn('inline-flex items-center gap-1', className)}>
      {keys.map((key, i) => (
        <React.Fragment key={i}>
          <Kbd>{key === MOD_KEY ? modifierKey : key}</Kbd>
          {i < keys.length - 1 && (
            <span className="text-xs text-muted-foreground">+</span>
          )}
        </React.Fragment>
      ))}
    </span>
  )
}

export type KbdSubmitShortcutProps = {
  className?: string
}

export function KbdSubmitShortcut({ className }: KbdSubmitShortcutProps) {
  return <KbdShortcut keys={[MOD_KEY, 'Enter']} className={className} />
}
