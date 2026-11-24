'use client'

import * as React from 'react'
import Link from 'next/link'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { EntryGroup } from '@/lib/groups'
import { PageHeader } from './PageHeader'

export type EntryCardData = {
  id: string
  title: string
  href: string
  description?: string
  importPath: string
  exampleCount: number
}

const TITLE_KEYS: Record<EntryGroup, { title: string; lead: string }> = {
  foundations: { title: 'design.index.foundationsTitle', lead: 'design.index.foundationsLead' },
  components: { title: 'design.index.componentsTitle', lead: 'design.index.componentsLead' },
  blocks: { title: 'design.index.blocksTitle', lead: 'design.index.blocksLead' },
}

export function EntryIndex({ group, cards }: { group: EntryGroup; cards: EntryCardData[] }) {
  const t = useT()
  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <PageHeader overline={t(`design.nav.${group}`)} title={t(TITLE_KEYS[group].title)} lead={t(TITLE_KEYS[group].lead)} />
      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map((card) => (
          <li key={card.id} className="min-w-0">
            <Link
              href={card.href}
              className="flex h-full min-w-0 flex-col gap-2 rounded-xl border border-border bg-card p-5 transition-colors hover:border-input hover:bg-muted/40 focus-visible:outline-none focus-visible:shadow-focus"
            >
              <span className="text-lg text-foreground">{card.title}</span>
              {card.description ? <span className="line-clamp-3 text-sm text-muted-foreground">{card.description}</span> : null}
              <span className="mt-auto flex min-w-0 items-center justify-between gap-3 pt-2 text-xs text-muted-foreground">
                <code className="min-w-0 truncate font-mono">{card.importPath}</code>
                <span className="shrink-0">{card.exampleCount === 1 ? t('design.index.exampleCountOne') : t('design.index.exampleCount', { count: card.exampleCount })}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
