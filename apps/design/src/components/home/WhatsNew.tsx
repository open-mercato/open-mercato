'use client'

import * as React from 'react'
import Link from 'next/link'
import { ArrowUpRight, Sparkles } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { KeyValue } from '@open-mercato/ui/blocks/key-value'
import { Timeline } from '@open-mercato/ui/blocks/timeline'
import { Anchor } from '@open-mercato/ui/primitives/anchor'
import { BorderBeam } from '@open-mercato/ui/primitives/border-beam'
import { FormField } from '@open-mercato/ui/primitives/form-field'
import { Input } from '@open-mercato/ui/primitives/input'
import { Splitter, SplitterPanel } from '@open-mercato/ui/primitives/splitter'
import { Tag } from '@open-mercato/ui/primitives/tag'

type Highlight = {
  id: string
  href: string
  status: 'new' | 'updated'
  render: () => React.ReactNode
}

function TimelineDemo() {
  const t = useT()
  return (
    <Timeline
      order="desc"
      items={[
        {
          id: 'whats-new-timeline',
          occurredAt: '2026-11-25T09:50:00Z',
          kind: 'update',
          icon: 'pencil-line',
          title: t('design.home.panel.timelineChanged'),
          author: { name: 'Alex Smith' },
          changes: [{ key: 'stage', label: t('design.home.panel.stage'), to: t('design.home.panel.stageQualified') }],
        },
      ]}
    />
  )
}

function SpacingDemo() {
  const t = useT()
  return (
    <FormField label={t('design.home.panel.workspaceName')} description={t('design.home.panel.emailHint')}>
      <Input defaultValue="Northline" />
    </FormField>
  )
}

function BeamDemo() {
  const t = useT()
  return (
    <BorderBeam className="rounded-card border border-border bg-card">
      <p className="flex items-center gap-2 p-4 text-sm text-foreground">
        <Sparkles aria-hidden className="size-4 text-accent-indigo" />
        {t('design.home.whatsNew.beamSample')}
      </p>
    </BorderBeam>
  )
}

function SplitterDemo() {
  const t = useT()
  return (
    <Splitter className="h-24 rounded-card border border-border bg-card">
      <SplitterPanel defaultSize={40} minSize={25}>
        <p className="p-3 text-sm text-muted-foreground">{t('design.home.whatsNew.splitterList')}</p>
      </SplitterPanel>
      <SplitterPanel minSize={30}>
        <p className="p-3 text-sm text-muted-foreground">{t('design.home.whatsNew.splitterPreview')}</p>
      </SplitterPanel>
    </Splitter>
  )
}

function AnchorDemo() {
  const t = useT()
  return (
    <Anchor
      label={t('design.home.whatsNew.anchorLabel')}
      items={[
        { href: '#home-anchor-overview', title: t('design.home.whatsNew.anchorOverview') },
        { href: '#home-anchor-lines', title: t('design.home.whatsNew.anchorLines') },
        { href: '#home-anchor-history', title: t('design.home.whatsNew.anchorHistory') },
      ]}
    />
  )
}

function KeyValueDemo() {
  const t = useT()
  return (
    <KeyValue
      items={[
        { key: 'owner', label: t('design.home.panel.owner'), value: 'Maya Chen' },
        { key: 'segment', label: t('design.home.panel.segment'), value: 'Enterprise' },
      ]}
    />
  )
}

const HIGHLIGHTS: Highlight[] = [
  { id: 'timeline', href: '/blocks/timeline/', status: 'updated', render: () => <TimelineDemo /> },
  { id: 'spacing', href: '/foundations/spacing/', status: 'new', render: () => <SpacingDemo /> },
  { id: 'border-beam', href: '/components/border-beam/', status: 'new', render: () => <BeamDemo /> },
  { id: 'splitter', href: '/components/splitter/', status: 'new', render: () => <SplitterDemo /> },
  { id: 'anchor', href: '/components/anchor/', status: 'new', render: () => <AnchorDemo /> },
  { id: 'key-value', href: '/blocks/key-value/', status: 'updated', render: () => <KeyValueDemo /> },
]

export function WhatsNew() {
  const t = useT()
  return (
    <section aria-labelledby="home-whats-new" className="flex flex-col gap-6">
      <div className="flex flex-col items-center gap-2 text-center">
        <h2 id="home-whats-new" className="text-3xl tracking-tight text-foreground sm:text-4xl">{t('design.home.whatsNew.title')}</h2>
        <p className="max-w-2xl text-base text-muted-foreground">{t('design.home.whatsNew.lead')}</p>
      </div>
      <div
        role="region"
        aria-labelledby="home-whats-new"
        tabIndex={0}
        className="flex snap-x snap-mandatory gap-gutter overflow-x-auto rounded-card pb-2 outline-none focus-visible:shadow-focus"
      >
        {HIGHLIGHTS.map((highlight) => (
          <article
            key={highlight.id}
            data-home-highlight={highlight.id}
            className="flex w-72 shrink-0 snap-start flex-col gap-4 rounded-card border border-border bg-card p-panel"
          >
            <header className="flex items-center justify-between gap-2">
              <Link href={highlight.href} className="inline-flex items-center gap-1 rounded-sm text-lg text-foreground outline-none hover:underline focus-visible:shadow-focus">
                {t(`design.home.whatsNew.items.${highlight.id}`)}
                <ArrowUpRight aria-hidden className="size-4 text-muted-foreground" />
              </Link>
              <Tag variant={highlight.status === 'new' ? 'info' : 'neutral'} shape="square">
                {t(`design.home.whatsNew.${highlight.status}`)}
              </Tag>
            </header>
            <div className="min-h-32 min-w-0 flex-1">{highlight.render()}</div>
          </article>
        ))}
      </div>
    </section>
  )
}
