'use client'

import * as React from 'react'
import { Moon, Sun } from 'lucide-react'
import { useTheme } from './ThemeProvider'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'

type ThemeToggleProps = {
  className?: string
}

export function ThemeToggle({ className }: ThemeToggleProps) {
  const { resolvedTheme, setTheme } = useTheme()
  const t = useT()
  const [mounted, setMounted] = React.useState(false)

  React.useEffect(() => {
    setMounted(true)
  }, [])

  const isDark = resolvedTheme === 'dark'
  const toggleLabel = t('common.theme.toggle', 'Toggle theme')

  const toggle = () => {
    setTheme(isDark ? 'light' : 'dark')
  }

  // Render placeholder during SSR to prevent hydration mismatch
  if (!mounted) {
    return (
      <div
        className={cn(
          'relative flex h-7 w-14 items-center rounded-full bg-muted p-1',
          className
        )}
        aria-hidden="true"
      >
        <div className="flex w-full justify-between px-1">
          <Sun className="size-3.5 text-muted-foreground" />
          <Moon className="size-3.5 text-muted-foreground" />
        </div>
      </div>
    )
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={isDark}
      aria-label={toggleLabel}
      onClick={toggle}
      className={cn(
        'relative flex h-7 w-14 cursor-pointer items-center rounded-full p-1 transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        isDark ? 'bg-primary' : 'bg-muted',
        className
      )}
    >
      {/* Sliding indicator */}
      <span
        className={cn(
          'absolute size-5 rounded-full bg-background shadow-sm transition-transform duration-200 motion-reduce:transition-none',
          isDark ? 'translate-x-7' : 'translate-x-0'
        )}
      />
      {/* Icons */}
      <span className="relative flex w-full justify-between px-0.5">
        <Sun
          className={cn(
            'size-3.5 transition-colors motion-reduce:transition-none',
            isDark ? 'text-muted-foreground' : 'text-amber-500'
          )}
        />
        <Moon
          className={cn(
            'size-3.5 transition-colors motion-reduce:transition-none',
            isDark ? 'text-primary-foreground' : 'text-muted-foreground'
          )}
        />
      </span>
      <span className="sr-only">
        {isDark ? t('common.theme.dark', 'Dark') : t('common.theme.light', 'Light')}
      </span>
    </button>
  )
}
