'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@open-mercato/ui/primitives/sheet'
import type { NavGroup } from '@/lib/manifest'
import { SideNav } from './SideNav'
import { TopBar } from './TopBar'

type DocsShellProps = {
  groups: NavGroup[]
  children: React.ReactNode
}

export function DocsShell({ groups, children }: DocsShellProps) {
  const t = useT()
  const [menuOpen, setMenuOpen] = React.useState(false)
  return (
    <div className="om-catalog-shell min-h-screen bg-background text-foreground">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-modal focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:shadow-focus">
        {t('design.nav.skipToContent')}
      </a>
      <TopBar onOpenMenu={() => setMenuOpen(true)} />
      <div className="flex w-full">
        <aside className="om-design-sidebar sticky top-14 hidden w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar lg:flex">
          <SideNav groups={groups} />
        </aside>
        <main id="main-content" className="min-w-0 flex-1 px-4 py-8 sm:px-6 lg:px-10 lg:py-10">
          {children}
        </main>
      </div>
      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent side="left" className="w-80 max-w-full gap-0 bg-sidebar p-0" closeLabel={t('design.nav.closeMenu')}>
          <SheetHeader>
            <SheetTitle>{t('design.nav.menuTitle')}</SheetTitle>
          </SheetHeader>
          <div className="flex min-h-0 flex-1 flex-col">
            <SideNav groups={groups} onNavigate={() => setMenuOpen(false)} />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}
