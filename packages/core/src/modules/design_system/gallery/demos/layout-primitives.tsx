"use client"

import * as React from 'react'
import { Sparkles } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Anchor } from '@open-mercato/ui/primitives/anchor'
import { BorderBeam, type BorderBeamColor } from '@open-mercato/ui/primitives/border-beam'
import { Button } from '@open-mercato/ui/primitives/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@open-mercato/ui/primitives/card'
import { Splitter, SplitterPanel } from '@open-mercato/ui/primitives/splitter'

function BeamPanel({ children, className }: { children?: React.ReactNode; className?: string }) {
  const t = useT()
  return (
    <div className={className ?? 'w-full max-w-sm space-y-2 p-6'}>
      <p className="flex items-center gap-2 text-sm text-foreground">
        <Sparkles className="size-4 text-accent-indigo" aria-hidden />
        {t('design_system.gallery.samples.beam.title')}
      </p>
      <p className="text-sm text-muted-foreground">{t('design_system.gallery.samples.beam.body')}</p>
      {children}
    </div>
  )
}

export function BorderBeamBasicExample() {
  return (
    <BorderBeam className="rounded-card border border-border bg-card">
      <BeamPanel />
    </BorderBeam>
  )
}

export function BorderBeamHoverExample() {
  const t = useT()
  return (
    <BorderBeam trigger="hover" className="rounded-card border border-border bg-card">
      <BeamPanel>
        <Button size="sm" variant="outline">{t('design_system.gallery.samples.beam.action')}</Button>
      </BeamPanel>
    </BorderBeam>
  )
}

export function BorderBeamMultipleExample() {
  return (
    <div className="grid w-full gap-6 sm:grid-cols-2">
      <BorderBeam count={2} className="rounded-card border border-border bg-card">
        <BeamPanel className="space-y-2 p-6" />
      </BorderBeam>
      <BorderBeam
        items={[{ color: 'var(--chart-blue)' }, { color: 'var(--chart-pink)', size: 60, lineWidth: 2 }]}
        className="rounded-card border border-border bg-card"
      >
        <BeamPanel className="space-y-2 p-6" />
      </BorderBeam>
    </div>
  )
}

export function BorderBeamCustomContainerExample() {
  const t = useT()
  return (
    <div className="flex w-full flex-wrap items-center gap-6">
      <BorderBeam asChild>
        <Card className="w-full max-w-xs">
          <CardHeader>
            <CardTitle>{t('design_system.gallery.samples.beam.title')}</CardTitle>
            <CardDescription>{t('design_system.gallery.samples.beam.body')}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button size="sm">{t('design_system.gallery.samples.beam.action')}</Button>
          </CardContent>
        </Card>
      </BorderBeam>
      <BorderBeam size={40} duration={4} className="rounded-full border border-border bg-card">
        <span className="flex items-center gap-2 px-4 py-2 text-sm text-foreground">
          <Sparkles className="size-4 text-accent-indigo" aria-hidden />
          {t('design_system.gallery.samples.beam.pill')}
        </span>
      </BorderBeam>
    </div>
  )
}

const GRADIENTS: Array<{ id: string; color: BorderBeamColor }> = [
  { id: 'indigo', color: [{ color: 'var(--chart-indigo)', percent: 0 }, { color: 'var(--chart-violet)', percent: 100 }] },
  { id: 'ocean', color: [{ color: 'var(--chart-blue)', percent: 0 }, { color: 'var(--chart-cyan)', percent: 50 }, { color: 'var(--chart-emerald)', percent: 100 }] },
  { id: 'sunset', color: [{ color: 'var(--chart-rose)', percent: 0 }, { color: 'var(--chart-orange)', percent: 50 }, { color: 'var(--chart-amber)', percent: 100 }] },
  { id: 'forest', color: [{ color: 'var(--chart-teal)', percent: 0 }, { color: 'var(--chart-emerald)', percent: 100 }] },
]

export function BorderBeamGradientsExample() {
  const t = useT()
  return (
    <div className="grid w-full gap-4 sm:grid-cols-2">
      {GRADIENTS.map((gradient) => (
        <BorderBeam key={gradient.id} color={gradient.color} lineWidth={2} className="rounded-card border border-border bg-card">
          <p className="p-6 text-sm text-foreground">{t(`design_system.gallery.samples.beam.gradient.${gradient.id}`)}</p>
        </BorderBeam>
      ))}
    </div>
  )
}

function BeamScale({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      {children}
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  )
}

export function BorderBeamDurationExample() {
  return (
    <div className="grid w-full gap-4 sm:grid-cols-3">
      {[3, 6, 12].map((seconds) => (
        <BeamScale key={seconds} label={`duration={${seconds}}`}>
          <BorderBeam duration={seconds} className="h-24 rounded-card border border-border bg-card" />
        </BeamScale>
      ))}
    </div>
  )
}

export function BorderBeamSizeExample() {
  return (
    <div className="grid w-full gap-4 sm:grid-cols-3">
      {[50, 100, 180].map((size) => (
        <BeamScale key={size} label={`size={${size}}`}>
          <BorderBeam size={size} className="h-24 rounded-card border border-border bg-card" />
        </BeamScale>
      ))}
    </div>
  )
}

export function BorderBeamLineWidthExample() {
  return (
    <div className="grid w-full gap-4 sm:grid-cols-3">
      {[1, 2, 4].map((width) => (
        <BeamScale key={width} label={`lineWidth={${width}}`}>
          <BorderBeam lineWidth={width} className="h-24 rounded-card border border-border bg-card" />
        </BeamScale>
      ))}
    </div>
  )
}

function PaneContent({ titleKey, bodyKey }: { titleKey: string; bodyKey: string }) {
  const t = useT()
  return (
    <div className="space-y-1 p-4">
      <p className="text-sm text-foreground">{t(titleKey)}</p>
      <p className="text-sm text-muted-foreground">{t(bodyKey)}</p>
    </div>
  )
}

export function SplitterBasicExample() {
  return (
    <Splitter className="h-64 w-full rounded-card border border-border bg-card">
      <SplitterPanel defaultSize={35} minSize={20}>
        <PaneContent titleKey="design_system.gallery.samples.splitter.list" bodyKey="design_system.gallery.samples.splitter.listBody" />
      </SplitterPanel>
      <SplitterPanel minSize={30}>
        <PaneContent titleKey="design_system.gallery.samples.splitter.preview" bodyKey="design_system.gallery.samples.splitter.previewBody" />
      </SplitterPanel>
    </Splitter>
  )
}

export function SplitterVerticalExample() {
  return (
    <Splitter orientation="vertical" className="h-72 w-full rounded-card border border-border bg-card">
      <SplitterPanel defaultSize={60} minSize={25}>
        <PaneContent titleKey="design_system.gallery.samples.splitter.editor" bodyKey="design_system.gallery.samples.splitter.editorBody" />
      </SplitterPanel>
      <SplitterPanel minSize={20}>
        <PaneContent titleKey="design_system.gallery.samples.splitter.log" bodyKey="design_system.gallery.samples.splitter.logBody" />
      </SplitterPanel>
    </Splitter>
  )
}

export function SplitterNestedExample() {
  return (
    <Splitter className="h-80 w-full rounded-card border border-border bg-card">
      <SplitterPanel defaultSize={25} minSize={15} maxSize={40}>
        <PaneContent titleKey="design_system.gallery.samples.splitter.list" bodyKey="design_system.gallery.samples.splitter.listBody" />
      </SplitterPanel>
      <SplitterPanel>
        <Splitter orientation="vertical" className="h-full">
          <SplitterPanel defaultSize={65}>
            <PaneContent titleKey="design_system.gallery.samples.splitter.preview" bodyKey="design_system.gallery.samples.splitter.previewBody" />
          </SplitterPanel>
          <SplitterPanel>
            <PaneContent titleKey="design_system.gallery.samples.splitter.log" bodyKey="design_system.gallery.samples.splitter.logBody" />
          </SplitterPanel>
        </Splitter>
      </SplitterPanel>
    </Splitter>
  )
}

const ANCHOR_SECTIONS = ['overview', 'lines', 'payments', 'shipping', 'history'] as const

function AnchorDemo({ nested }: { nested?: boolean }) {
  const t = useT()
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const baseId = React.useId().replace(/[^a-zA-Z0-9-]/g, '')
  const sectionId = (section: string) => `${baseId}-${section}`
  const getContainer = React.useCallback(() => scrollRef.current ?? window, [])
  const items = ANCHOR_SECTIONS.map((section) => ({
    href: `#${sectionId(section)}`,
    title: t(`design_system.gallery.samples.anchor.${section}`),
    ...(nested && section === 'payments'
      ? { children: [{ href: `#${sectionId('refunds')}`, title: t('design_system.gallery.samples.anchor.refunds') }] }
      : {}),
  }))
  const sections = nested ? [...ANCHOR_SECTIONS.slice(0, 3), 'refunds', ...ANCHOR_SECTIONS.slice(3)] : [...ANCHOR_SECTIONS]
  return (
    <div className="flex w-full flex-col-reverse rounded-card border border-border bg-card sm:flex-row sm:gap-6">
      <div ref={scrollRef} className="h-72 min-w-0 flex-1 overflow-y-auto p-4">
        {sections.map((section) => (
          <section key={section} id={sectionId(section)} className="space-y-1 border-b border-border py-6 last:border-b-0">
            <h4 className="text-base text-foreground">{t(`design_system.gallery.samples.anchor.${section}`)}</h4>
            <p className="text-sm text-muted-foreground">{t('design_system.gallery.samples.anchor.body')}</p>
            <div className="h-24 rounded-md bg-muted" aria-hidden />
          </section>
        ))}
      </div>
      <div className="shrink-0 border-b border-border p-4 sm:w-44 sm:border-b-0 sm:pl-0">
        <Anchor items={items} getContainer={getContainer} offset={16} />
      </div>
    </div>
  )
}

export function AnchorBasicExample() {
  return <AnchorDemo />
}

export function AnchorNestedExample() {
  return <AnchorDemo nested />
}
