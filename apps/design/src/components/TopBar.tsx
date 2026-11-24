'use client'

import * as React from 'react'
import Link from 'next/link'
import { GitBranch, Menu, Moon, Sun } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { SegmentedControl, SegmentedControlItem } from '@open-mercato/ui/primitives/segmented-control'
import { REPOSITORY_URL, type PreviewTheme } from '@/lib/links'
import { useDesignSettings } from './DesignSettings'

type TopBarProps = {
  onOpenMenu: () => void
}

function isPreviewTheme(value: string): value is PreviewTheme {
  return value === 'admin' || value === 'storefront'
}

export function TopBar({ onOpenMenu }: TopBarProps) {
  const t = useT()
  const { theme, setTheme, mode, setMode } = useDesignSettings()
  const darkLabel = mode === 'dark' ? t('design.topbar.darkModeOff') : t('design.topbar.darkModeOn')
  return (
    <header className="sticky top-0 z-sticky flex h-14 items-center gap-2 border-b border-border bg-background px-4 sm:gap-4 lg:px-6">
      <IconButton type="button" variant="ghost" className="lg:hidden" aria-label={t('design.nav.openMenu')} onClick={onOpenMenu}>
        <Menu />
      </IconButton>
      <Link href="/" aria-label={t('design.topbar.home')} className="hidden min-w-0 items-baseline gap-1.5 rounded-md sm:flex focus-visible:outline-none focus-visible:shadow-focus">
        <span className="whitespace-nowrap text-base text-foreground">{t('design.topbar.brand')}</span>
        <span className="hidden text-base text-muted-foreground sm:inline">{t('design.topbar.brandSuffix')}</span>
      </Link>
      <div className="ml-auto flex items-center gap-1 sm:gap-2">
        <SegmentedControl
          size="sm"
          aria-label={t('design.topbar.themeLabel')}
          value={theme}
          onValueChange={(value) => {
            if (isPreviewTheme(value)) setTheme(value)
          }}
        >
          <SegmentedControlItem value="admin">{t('design.topbar.themeAdmin')}</SegmentedControlItem>
          <SegmentedControlItem value="storefront">{t('design.topbar.themeStorefront')}</SegmentedControlItem>
        </SegmentedControl>
        <IconButton
          type="button"
          variant="ghost"
          aria-label={darkLabel}
          title={darkLabel}
          onClick={() => setMode(mode === 'dark' ? 'light' : 'dark')}
        >
          {mode === 'dark' ? <Sun /> : <Moon />}
        </IconButton>
        <IconButton asChild variant="ghost" aria-label={t('design.topbar.repository')} title={t('design.topbar.repository')}>
          <a href={REPOSITORY_URL} target="_blank" rel="noreferrer">
            <GitBranch />
          </a>
        </IconButton>
      </div>
    </header>
  )
}
