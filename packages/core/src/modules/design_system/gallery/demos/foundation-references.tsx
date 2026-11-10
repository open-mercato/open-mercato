'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { SearchInput } from '@open-mercato/ui/primitives/search-input'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { colors, grid, radius, shadows, typography } from './foundation-reference-data'

function ReferenceNote({ message }: { message: string }) {
  const t = useT()
  return <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">{t(`design_system.foundations.reference.${message}`)}</p>
}

export function SourceTypography() {
  const t = useT()
  return <div className="space-y-6">
    <ReferenceNote message="typographyNote" />
    <div className="divide-y divide-border">
      {typography.map(item => <article key={item.id} className="min-w-0 space-y-4 py-6" data-foundation="typography">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h4 className="text-sm font-medium">{t(`design_system.foundations.reference.type.${item.id}`)}</h4>
          <dl className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground">
            <div><dt className="inline">{t('design_system.foundations.reference.sizeHeight')} </dt><dd className="inline font-mono">{item.size}/{item.lineHeight} px</dd></div>
            <div><dt className="inline">{t('design_system.foundations.reference.weight')} </dt><dd className="inline font-mono">{item.weight}</dd></div>
            <div><dt className="inline">{t('design_system.foundations.reference.tracking')} </dt><dd className="inline font-mono">{item.tracking}%</dd></div>
          </dl>
        </div>
        <p className="break-words font-sans" style={{ fontSize: item.size, lineHeight: `${item.lineHeight}px`, fontWeight: item.weight, letterSpacing: `${item.tracking / 100}em`, textTransform: item.name.toLowerCase().startsWith('subhead') ? 'uppercase' : undefined }}>{t('design_system.gallery.samples.typeSample')}</p>
      </article>)}
    </div>
  </div>
}

export function SourceRadius() {
  const t = useT()
  return <div className="space-y-6">
    <ReferenceNote message="radiusNote" />
    <div className="grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-3 xl:grid-cols-4">
      {radius.map(item => <article key={item.id} className="space-y-3" data-foundation="radius">
        <div className="h-24 border-2 border-foreground bg-muted/40" style={{ borderRadius: item.pixels }} aria-hidden />
        <div className="flex flex-wrap justify-between gap-2 text-sm"><code>{item.name}</code><span className="text-muted-foreground">{item.pixels} px</span></div>
        <p className="text-xs text-muted-foreground">{item.applicationClassName ?? t('design_system.foundations.reference.sourceOnly')}</p>
      </article>)}
    </div>
  </div>
}

export function SourceShadows() {
  const t = useT()
  return <div className="space-y-6">
    <ReferenceNote message="shadowNote" />
    <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
      {shadows.map(item => <article key={item.id} className="min-w-0 space-y-4 rounded-lg border border-border p-5" data-foundation="shadow">
        <div className="flex h-40 items-center justify-center overflow-hidden rounded-md" style={{ backgroundColor: '#ffffff' }}>
          <div className="h-20 w-28 rounded-lg" style={{ backgroundColor: '#ffffff', boxShadow: item.css }} aria-hidden />
        </div>
        <h4 className="text-sm font-medium">{t(`design_system.foundations.reference.shadow.${item.id}`)}</h4>
        <code className="block break-words text-xs text-muted-foreground">{item.name}</code>
        <section className="text-xs">
          <h5 className="text-xs font-medium">{t('design_system.foundations.reference.shadowLayers')}</h5>
          <code className="mt-3 block break-words leading-relaxed text-muted-foreground">{item.css}</code>
        </section>
      </article>)}
    </div>
  </div>
}

export function SourceGrids() {
  const t = useT()
  return <div className="space-y-8">
    <ReferenceNote message="gridNote" />
    {grid.map(item => <article key={item.id} className="space-y-4" data-foundation="grid">
      <h4 className="text-base font-medium">{t(`design_system.foundations.reference.grid.${item.id}`)}</h4>
      <div role="img" aria-label={t(`design_system.foundations.reference.grid.${item.id}`)} className="relative flex h-36 overflow-hidden rounded-lg border border-border bg-background sm:h-48">
        {item.sidebar > 0 ? <div className="h-full shrink-0 bg-primary" style={{ width: `${item.sidebar / item.width * 100}%` }} /> : null}
        {item.submenu > 0 ? <div className="h-full shrink-0 bg-muted" style={{ width: `${item.submenu / item.width * 100}%` }} /> : null}
        <div className="flex h-full min-w-0 flex-1" style={{ paddingInline: `${item.safe / item.width * 100}%`, gap: `${item.gutter / (item.width - item.sidebar - item.submenu - item.safe * 2) * 100}%` }}>
          {Array.from({ length: 12 }, (_, index) => <div key={index} className="h-full min-w-0 flex-1 bg-primary/15" />)}
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
        <div><dt className="text-xs text-muted-foreground">{t('design_system.figmaFoundations.columns')}</dt><dd className="mt-1 font-mono">12 × {item.column} px</dd></div>
        <div><dt className="text-xs text-muted-foreground">{t('design_system.figmaFoundations.gutter')}</dt><dd className="mt-1 font-mono">{item.gutter} px</dd></div>
        <div><dt className="text-xs text-muted-foreground">{t('design_system.figmaFoundations.safeArea')}</dt><dd className="mt-1 font-mono">{item.safe} px</dd></div>
        <div><dt className="text-xs text-muted-foreground">{t('design_system.figmaFoundations.sidebar')}</dt><dd className="mt-1 font-mono">{item.sidebar}{item.submenu ? ` + ${item.submenu}` : ''} px</dd></div>
      </dl>
    </article>)}
  </div>
}

function colorGroup(item: typeof colors[number]) {
  if (item.mode) return item.mode
  if (item.kind.startsWith('Color/')) return 'brand'
  if (item.name.includes(' [')) return item.name.split(' [')[0].toLowerCase()
  return item.name.split('-')[0]
}

function SourceSwatch({ item }: { item: typeof colors[number] }) {
  const t = useT()
  const value = item.opacity < 1 ? `${item.hex}${Math.round(item.opacity * 255).toString(16).padStart(2, '0')}` : item.hex
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      flash(t('design_system.gallery.tokenCopied', { token: value }), 'success')
    } catch {
      flash(t('design_system.gallery.tokenCopyFailed'), 'error')
    }
  }
  return <Button type="button" variant="ghost" onClick={copy} title={t('design_system.gallery.copyToken', { token: value })} className="h-auto min-w-0 flex-col items-stretch justify-start gap-2 whitespace-normal rounded-md p-1.5 text-left" data-foundation="color">
    <span aria-hidden className="block h-16 shrink-0 overflow-hidden rounded-md border border-border bg-background"><span className="block h-full" style={{ backgroundColor: item.hex, opacity: item.opacity }} /></span>
    <span className="break-words text-xs font-medium">{item.role || item.name}</span>
    <span className="font-mono text-xs text-muted-foreground">{value.toUpperCase()}</span>
    {item.mismatch ? <span className="text-overline leading-normal text-muted-foreground">{t('design_system.foundations.reference.sourceCaption', { value: item.captions.join(', ') })}</span> : null}
  </Button>
}

export function SourceColors() {
  const t = useT()
  const [query, setQuery] = React.useState('')
  const needle = query.trim().toLocaleLowerCase()
  const grouped = new Map<string, Array<typeof colors[number]>>()
  for (const item of colors) {
    const group = colorGroup(item)
    const label = t(`design_system.foundations.reference.colorGroup.${group}`, group)
    if (needle && !`${label} ${item.name} ${item.role ?? ''} ${item.hex} ${item.captions.join(' ')}`.toLocaleLowerCase().includes(needle)) continue
    const items = grouped.get(group) ?? []
    items.push(item)
    grouped.set(group, items)
  }
  return <div className="space-y-8">
    <ReferenceNote message="colorNote" />
    <SearchInput value={query} onChange={setQuery} aria-label={t('design_system.figmaFoundations.filterColors')} placeholder={t('design_system.figmaFoundations.filterColors')} className="max-w-xl" />
    {Array.from(grouped, ([group, items]) => <section key={group} className="space-y-3">
      <h4 className="text-sm font-medium">{t(`design_system.foundations.reference.colorGroup.${group}`, group)}</h4>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-6">{items.map(item => <SourceSwatch key={item.id} item={item} />)}</div>
    </section>)}
    {grouped.size === 0 ? <p className="text-sm text-muted-foreground">{t('design_system.figmaFoundations.emptyResults')}</p> : null}
  </div>
}
