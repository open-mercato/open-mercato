'use client'

import * as React from 'react'
import Link from 'next/link'
import { ArrowRight, ArrowUpRight, Bot, Box, Braces, Columns3, Layers, LayoutGrid, Palette, Rows3, Shapes, Type } from 'lucide-react'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { BorderBeam } from '@open-mercato/ui/primitives/border-beam'
import { Button } from '@open-mercato/ui/primitives/button'
import { Tag } from '@open-mercato/ui/primitives/tag'
import type { EntryGroup } from '@/lib/groups'
import { LivePanel } from '@/components/home/LivePanel'
import { WhatsNew } from '@/components/home/WhatsNew'

const NEWS = [
  { id: 'timeline', href: '/blocks/timeline/', date: '2026-11-25', fresh: true },
  { id: 'spacing', href: '/foundations/spacing/', date: '2026-11-25', fresh: false },
  { id: 'primitives', href: '/components/border-beam/', date: '2026-11-25', fresh: false },
] as const

const LIBRARY = [
  { group: 'blocks', art: [LayoutGrid, Rows3, Columns3], description: 'design.intro.howBlocks' },
  { group: 'components', art: [Shapes, Box, Layers], description: 'design.intro.howComponents' },
  { group: 'foundations', art: [Palette, Type, Braces], description: 'design.intro.howFoundations' },
] as const

function formatDate(value: string, locale: string): string {
  const date = new Date(`${value}T12:00:00Z`)
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(date)
}

function HomeHero() {
  const t = useT()
  const locale = useLocale()
  return (
    <section aria-labelledby="intro-title" className="flex flex-col items-center gap-8 text-center">
      <div className="flex flex-col items-center gap-5">
        <BorderBeam className="rounded-card border border-border bg-card sm:rounded-full">
          <a
            href="/llms.txt"
            className="flex items-center gap-3 rounded-card px-4 py-2 text-left text-sm text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:shadow-focus sm:rounded-full"
          >
            <Bot aria-hidden className="size-4 shrink-0 text-accent-indigo" />
            <span className="min-w-0">{t('design.intro.agentsBody')}</span>
            <span className="flex shrink-0 items-center gap-1 font-mono text-foreground">llms.txt<ArrowUpRight aria-hidden className="size-4" /></span>
          </a>
        </BorderBeam>
        <h1 id="intro-title" className="text-5xl font-normal tracking-tight text-foreground sm:text-6xl">{t('design.home.title')}</h1>
        <p className="max-w-2xl text-lg text-muted-foreground">{t('design.home.lead')}</p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Button asChild>
            <Link href="/blocks/">{t('design.home.primaryAction')}<ArrowRight aria-hidden className="size-4" /></Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/foundations/">{t('design.home.secondaryAction')}</Link>
          </Button>
        </div>
      </div>
      <ul className="grid w-full gap-gutter text-left md:grid-cols-3">
        {NEWS.map((item) => (
          <li key={item.id}>
            <Link
              href={item.href}
              className="group flex h-full flex-col gap-3 rounded-card border border-border bg-card p-panel outline-none transition-colors hover:border-input focus-visible:shadow-focus"
            >
              <span className="flex items-start justify-between gap-3">
                <span className="text-base text-foreground">{t(`design.home.news.${item.id}.title`)}</span>
                {item.fresh ? <Tag variant="info" shape="square">{t('design.home.whatsNew.new')}</Tag> : null}
              </span>
              <span className="flex-1 text-sm text-muted-foreground">{t(`design.home.news.${item.id}.body`)}</span>
              <time dateTime={item.date} className="text-xs text-muted-foreground">{formatDate(item.date, locale)}</time>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

function LibraryCards({ counts }: { counts: Record<EntryGroup, number> }) {
  const t = useT()
  return (
    <section aria-labelledby="intro-library" className="flex flex-col gap-6">
      <div className="flex flex-col items-center gap-2 text-center">
        <h2 id="intro-library" className="text-3xl tracking-tight text-foreground sm:text-4xl">{t('design.intro.howTitle')}</h2>
        <p className="max-w-2xl text-base text-muted-foreground">{t('design.home.libraryLead')}</p>
      </div>
      <ul className="grid gap-gutter md:grid-cols-3">
        {LIBRARY.map(({ group, art, description }) => (
          <li key={group}>
            <Link
              href={`/${group}/`}
              className="group flex h-full flex-col overflow-hidden rounded-card border border-border bg-card outline-none transition-colors hover:border-input focus-visible:shadow-focus"
            >
              <span aria-hidden className="flex h-32 items-center justify-center gap-6 border-b border-border bg-muted/60 text-muted-foreground transition-colors group-hover:text-foreground">
                {art.map((Icon, index) => (
                  <Icon key={index} className="size-8" strokeWidth={1.25} />
                ))}
              </span>
              <span className="flex flex-1 flex-col gap-2 p-panel">
                <span className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1 text-lg text-foreground">
                    {t(`design.nav.${group}`)}
                    <ArrowUpRight aria-hidden className="size-4 text-muted-foreground" />
                  </span>
                  <span className="rounded-md bg-muted px-2 font-mono text-xs leading-5 text-muted-foreground">{counts[group]}</span>
                </span>
                <span className="text-sm text-muted-foreground">{t(description)}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

export function IntroContent({ counts }: { counts: Record<EntryGroup, number> }) {
  return (
    <div className="om-design-intro mx-auto flex max-w-6xl flex-col gap-16 py-8 lg:gap-24 lg:py-12">
      <HomeHero />
      <LivePanel />
      <WhatsNew />
      <LibraryCards counts={counts} />
    </div>
  )
}
