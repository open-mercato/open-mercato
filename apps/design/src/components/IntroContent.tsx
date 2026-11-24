'use client'

import * as React from 'react'
import Link from 'next/link'
import { ArrowRight, ArrowUpRight, Box, Braces, Layers, PackageCheck, Wrench } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { KeyValue } from '@open-mercato/ui/blocks/key-value'
import { Stack } from '@open-mercato/ui/blocks/stack'
import { Button } from '@open-mercato/ui/primitives/button'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { SegmentedControl, SegmentedControlItem } from '@open-mercato/ui/primitives/segmented-control'
import type { EntryGroup } from '@/lib/groups'
import { useDesignSettings } from './DesignSettings'

const sections = [
  { group: 'blocks', icon: Layers, description: 'design.intro.howBlocks' },
  { group: 'components', icon: Box, description: 'design.intro.howComponents' },
  { group: 'foundations', icon: Braces, description: 'design.intro.howFoundations' },
] as const

type ExampleModule = 'service' | 'warehouse'

function RecordPreview() {
  const t = useT()
  const { theme } = useDesignSettings()
  const [module, setModule] = React.useState<ExampleModule>('service')
  const [completed, setCompleted] = React.useState({ service: false, warehouse: false })
  const done = completed[module]
  const Icon = module === 'service' ? Wrench : PackageCheck
  const label = (key: string) => t(`design.intro.${module}.${key}`)

  return (
    <figure className="om-record-stage min-w-0 rounded-xl p-4 sm:p-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <span className="font-mono text-xs font-semibold uppercase tracking-widest">{t('design.intro.preview')}</span>
        <SegmentedControl className="om-design-switch" size="sm" value={module} aria-label={t('design.intro.chooseModule')}
          onValueChange={(value) => { if (value === 'service' || value === 'warehouse') setModule(value) }}>
          <SegmentedControlItem value="service">{t('design.intro.service.label')}</SegmentedControlItem>
          <SegmentedControlItem value="warehouse">{t('design.intro.warehouse.label')}</SegmentedControlItem>
        </SegmentedControl>
      </div>
      <div data-design-specimen="" data-theme={theme} className="font-sans rounded-card border border-border bg-card p-5 text-card-foreground shadow-sm sm:p-6">
        <Stack gap={4}>
          <div className="flex items-center justify-between gap-3">
            <span className="inline-flex items-center gap-2 font-mono text-xs text-muted-foreground">
              <Icon aria-hidden className="size-4" />{module === 'service' ? 'WO–2048' : 'GR–1062'}
            </span>
            <span aria-live="polite" aria-atomic="true"><StatusBadge variant={done ? 'success' : 'info'}>{label(done ? 'done' : 'status')}</StatusBadge></span>
          </div>
          <h2 className="text-2xl font-semibold leading-tight tracking-tight">{label('title')}</h2>
          <KeyValue columns={2} items={[
            { key: 'owner', label: label('field1'), value: label('value1') },
            { key: 'place', label: label('field2'), value: label('value2') },
          ]} />
          <div className="border-t border-dashed border-border pt-4">
            <Button type="button" size="sm" variant={done ? 'outline' : 'default'}
              onClick={() => setCompleted((previous) => ({ ...previous, [module]: !previous[module] }))}>
              {label(done ? 'undo' : 'action')}<ArrowRight aria-hidden className="size-4" />
            </Button>
          </div>
        </Stack>
      </div>
      <figcaption className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span>{t('design.intro.composed')}</span>
        <Link href="/blocks/key-value/" className="om-spec-link">KeyValue<ArrowUpRight aria-hidden className="size-3" /></Link>
        <Link href="/blocks/stack/" className="om-spec-link">Stack<ArrowUpRight aria-hidden className="size-3" /></Link>
      </figcaption>
    </figure>
  )
}

export function IntroContent({ counts }: { counts: Record<EntryGroup, number> }) {
  const t = useT()
  return (
    <div className="om-design-intro mx-auto max-w-6xl space-y-12 lg:space-y-16">
      <section className="om-design-spread" aria-labelledby="intro-title">
        <div className="flex flex-col items-start justify-center gap-5">
          <p className="flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-muted-foreground">
            <span aria-hidden className="h-px w-8 bg-current" />{t('design.intro.overline')}
          </p>
          <h1 id="intro-title" className="om-display font-semibold tracking-tight">{t('design.intro.title')}</h1>
          <p className="max-w-md text-base leading-relaxed text-muted-foreground">{t('design.intro.lead')}</p>
          <Button asChild><Link href="/blocks/">{t('design.intro.browseBlocks')}<ArrowRight aria-hidden className="size-4" /></Link></Button>
        </div>
        <RecordPreview />
      </section>
      <section className="space-y-5" aria-labelledby="intro-library">
        <h2 id="intro-library" className="text-2xl font-semibold tracking-tight">{t('design.intro.howTitle')}</h2>
        <ul className="grid gap-3 sm:grid-cols-3">
          {sections.map(({ group, icon: Icon, description }) => (
            <li key={group}>
              <Link href={`/${group}/`} className="om-library-card group flex h-full flex-col gap-4 rounded-lg border border-input bg-card p-5 transition-colors focus-visible:shadow-focus">
                <div className="flex items-center justify-between">
                  <Icon aria-hidden className="size-5" />
                  <span className="rounded-md bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground">{counts[group]}</span>
                </div>
                <div className="space-y-1.5">
                  <span className="flex items-center gap-1.5 text-lg font-semibold tracking-tight">{t(`design.nav.${group}`)}<ArrowUpRight aria-hidden className="size-4 text-muted-foreground" /></span>
                  <span className="block text-sm leading-relaxed text-muted-foreground">{t(description)}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </section>
      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border py-5 text-sm text-muted-foreground">
        <span>{t('design.intro.agentsBody')}</span>
        <a href="/llms.txt" className="om-spec-link font-mono text-foreground">llms.txt<ArrowUpRight aria-hidden className="size-4" /></a>
      </footer>
    </div>
  )
}
