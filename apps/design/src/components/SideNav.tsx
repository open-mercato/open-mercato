'use client'

import * as React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import type { NavGroup } from '@/lib/manifest'

type SideNavProps = {
  groups: NavGroup[]
  onNavigate?: () => void
}

function normalize(pathname: string): string {
  return pathname.endsWith('/') ? pathname : `${pathname}/`
}

function NavLink({ href, active, children, onNavigate }: { href: string; active: boolean; children: React.ReactNode; onNavigate?: () => void }) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'block rounded-md px-3 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:shadow-focus',
        active ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
      )}
    >
      {children}
    </Link>
  )
}

export function SideNav({ groups, onNavigate }: SideNavProps) {
  const t = useT()
  const pathname = normalize(usePathname() ?? '/')
  const introduction = [
    { href: '/', label: t('design.nav.overview') },
    { href: '/foundations/', label: t('design.nav.allFoundations') },
    { href: '/components/', label: t('design.nav.allComponents') },
    { href: '/blocks/', label: t('design.nav.allBlocks') },
  ]
  return (
    <nav aria-label={t('design.nav.label')} className="space-y-6">
      <section className="space-y-1">
        <h2 className="px-3 text-overline uppercase tracking-widest text-muted-foreground">{t('design.nav.introduction')}</h2>
        <ul className="space-y-0.5">
          {introduction.map((item) => (
            <li key={item.href}>
              <NavLink href={item.href} active={pathname === item.href} onNavigate={onNavigate}>{item.label}</NavLink>
            </li>
          ))}
        </ul>
      </section>
      {groups.map((group) => (
        <section key={group.group} className="space-y-1">
          <h2 className="px-3 text-overline uppercase tracking-widest text-muted-foreground">{t(`design.nav.${group.group}`)}</h2>
          <ul className="space-y-0.5">
            {group.items.map((item) => (
              <li key={item.id}>
                <NavLink href={item.href} active={pathname === item.href} onNavigate={onNavigate}>{item.title}</NavLink>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </nav>
  )
}
