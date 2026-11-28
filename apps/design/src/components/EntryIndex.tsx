'use client'

import * as React from 'react'
import Link from 'next/link'
import { ArrowUpRight, Package } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { EntityHeader } from '@open-mercato/ui/blocks/entity-header'
import { KeyValue } from '@open-mercato/ui/blocks/key-value'
import { Inline, Stack } from '@open-mercato/ui/blocks/stack'
import { Timeline } from '@open-mercato/ui/blocks/timeline'
import { SearchInput } from '@open-mercato/ui/primitives/search-input'
import { StepIndicator } from '@open-mercato/ui/primitives/step-indicator'
import { Tag } from '@open-mercato/ui/primitives/tag'
import type { EntryGroup } from '@/lib/groups'
import { EntryThumbnail } from './EntryThumbnail'
import { PageHeader } from './PageHeader'

export type EntryCardData = {
  id: string
  title: string
  href: string
  description?: string
  importPath: string
  family: string
  exampleCount: number
}

const TITLE_KEYS: Record<EntryGroup, { title: string; lead: string }> = {
  foundations: { title: 'design.index.foundationsTitle', lead: 'design.index.foundationsLead' },
  components: { title: 'design.index.componentsTitle', lead: 'design.index.componentsLead' },
  blocks: { title: 'design.index.blocksTitle', lead: 'design.index.blocksLead' },
}

function BlockSpecimen({ id }: { id: string }) {
  const t = useT()
  switch (id) {
    case 'entity-header':
      return (
        <EntityHeader
          leading={<span className="grid size-10 place-items-center rounded-lg bg-muted"><Package className="size-5" /></span>}
          title={t('design.sample.receipt')}
          subtitle={t('design.sample.warehouse')}
          badge={{ label: t('design.sample.ready'), tone: 'success' }}
        />
      )
    case 'key-value':
      return (
        <KeyValue items={[
          { key: 'location', label: t('design.sample.location'), value: t('design.sample.warehouse') },
          { key: 'owner', label: t('design.sample.owner'), value: t('design.sample.ownerName') },
        ]} />
      )
    case 'timeline':
      return (
        <Timeline order="desc" groupBy="none" items={[
          { id: 'packed', kind: 'packed', occurredAt: '2026-03-12T10:15:00Z', title: t('design.sample.packed') },
          { id: 'received', kind: 'received', occurredAt: '2026-03-12T09:00:00Z', title: t('design.sample.received') },
        ]} />
      )
    case 'kanban':
      return (
        <div className="grid grid-cols-2 gap-2">
          {[
            { id: 'packed', title: t('design.sample.packed'), card: t('design.sample.receipt') },
            { id: 'in-transit', title: t('design.sample.inTransit'), card: t('design.sample.shipments') },
          ].map((column) => (
            <div key={column.id} className="flex flex-col gap-2 rounded-card bg-muted p-2">
              <span className="px-1 text-xs text-muted-foreground">{column.title}</span>
              <span className="rounded-card border border-border bg-card px-2 py-1.5 text-xs text-foreground">{column.card}</span>
            </div>
          ))}
        </div>
      )
    case 'wizard':
      return (
        <StepIndicator size="sm" orientation="vertical" steps={[
          { id: 'details', label: t('design.sample.details'), status: 'complete' },
          { id: 'items', label: t('design.sample.items'), status: 'current' },
          { id: 'review', label: t('design.sample.review'), status: 'pending' },
        ]} />
      )
    case 'stack':
      return (
        <Stack gap={3}>
          <Inline gap={2} align="center"><Package className="size-5 text-muted-foreground" /><strong className="text-sm font-semibold">{t('design.sample.shipments')}</strong></Inline>
          <Inline gap={2} wrap>
            <Tag variant="success" dot>{t('design.sample.packed')}</Tag>
            <Tag variant="info" dot>{t('design.sample.inTransit')}</Tag>
          </Inline>
        </Stack>
      )
    default:
      return null
  }
}

export function EntryIndex({ group, cards }: { group: EntryGroup; cards: EntryCardData[] }) {
  const t = useT()
  const [query, setQuery] = React.useState('')
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const matches = cards.filter((card) => {
    const searchable = [card.title, card.id, card.description, card.importPath].join(' ').toLowerCase()
    return words.every((word) => searchable.includes(word))
  })
  const searchLabel = t('design.index.filter', { group: t(`design.nav.${group}`).toLowerCase() })
  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <PageHeader overline={t(`design.nav.${group}`)} title={t(TITLE_KEYS[group].title)} lead={t(TITLE_KEYS[group].lead)} />
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
        <SearchInput className="w-full sm:max-w-sm" value={query} onChange={setQuery} placeholder={searchLabel} aria-label={searchLabel} />
        <span role="status" className="text-sm tabular-nums text-muted-foreground">
          {t('design.index.resultCount', { visible: matches.length, total: cards.length })}
        </span>
      </div>
      {matches.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">{t('design.index.noMatches', { query })}</p>
      ) : (
        <ul className={group === 'blocks' ? 'grid gap-5 md:grid-cols-2' : 'grid gap-4 sm:grid-cols-2 xl:grid-cols-3'}>
          {matches.map((card) => (
            <li key={card.id} className="min-w-0">
              <div className="group relative flex h-full min-w-0 flex-col overflow-hidden rounded-xl border border-input bg-card transition-colors hover:border-foreground has-[a:focus-visible]:shadow-focus">
                {group === 'blocks' ? (
                  <div data-design-specimen="" aria-hidden="true" inert className="grid min-h-48 place-items-center border-b border-border bg-muted font-sans text-foreground px-5 py-6">
                    <div className="w-full max-w-sm rounded-card border border-border bg-card p-4 text-foreground shadow-xs">
                      <BlockSpecimen id={card.id} />
                    </div>
                  </div>
                ) : (
                  <EntryThumbnail familyId={card.family} entryId={card.id} />
                )}
                <div className="flex flex-1 flex-col gap-2 p-5">
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="text-lg font-normal tracking-tight text-foreground">
                      <Link href={card.href} className="after:absolute after:inset-0 focus-visible:outline-none">{card.title}</Link>
                    </h2>
                    <ArrowUpRight aria-hidden className="size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />
                  </div>
                  <p className="text-xs tabular-nums text-muted-foreground">
                    {card.exampleCount === 1 ? t('design.index.exampleCountOne') : t('design.index.exampleCount', { count: card.exampleCount })}
                  </p>
                  {card.description ? <p className="line-clamp-2 text-sm leading-relaxed text-muted-foreground">{card.description}</p> : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
