import * as React from 'react'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { SearchInput } from '@open-mercato/ui/primitives/search-input'
import { colors, durations, grid, radius, shadows, typography } from './FigmaFoundations.data'

const referenceFont = '"Inter Variable", Inter, sans-serif'
const applicationFont = 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
function SourceLink({ id }: { id: string }) {
  const t = useT()
  return <span className="text-xs text-muted-foreground" data-source-node={id}>{t('design_system.figmaFoundations.reference')}</span>
}

function ReferencePage({ name, note, children }: React.PropsWithChildren<{ name: string; note: string }>) {
  const t = useT()
  return <main className="mx-auto max-w-7xl space-y-8 px-5 py-10 sm:px-10">
    <header className="max-w-3xl space-y-3">
      <p className="text-overline font-semibold uppercase tracking-widest text-muted-foreground">{t('design_system.figmaFoundations.title')} · {t('design_system.figmaFoundations.reference')}</p>
      <h1 className="text-3xl font-semibold tracking-tight">{name}</h1>
      <p className="text-sm leading-6 text-muted-foreground">{t(note)}</p>
      <p className="rounded-lg border border-border bg-muted/40 p-4 text-sm leading-6">{t('design_system.figmaFoundations.notice')}</p>
    </header>
    {children}
  </main>
}

function TypographyReference() {
  const t = useT()
  return <ReferencePage name="Typography · 22 styles" note="design_system.figmaFoundations.fontNote">
    <p className="text-sm text-muted-foreground">{t('design_system.figmaFoundations.applicationTypeNote')}</p>
    <div className="space-y-6">
      {typography.map(item => <article className="space-y-4 rounded-xl border border-border p-5" key={item.id} data-foundation="typography">
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-sm font-semibold">{item.name}</h2><SourceLink id={item.id} /></div>
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="min-w-0 space-y-3">
            <p className="text-xs text-muted-foreground">{t('design_system.figmaFoundations.reference')} · {item.font}</p>
            <p className="break-words" style={{ fontFamily: referenceFont, fontSize: item.size, lineHeight: `${item.lineHeight}px`, fontWeight: item.weight, letterSpacing: `${item.tracking / 100}em`, textTransform: item.name.startsWith('subhead') ? 'uppercase' : undefined }}>{t('design_system.gallery.samples.typeSample')}</p>
            <code className="block text-xs text-muted-foreground">{item.size}/{item.lineHeight} px · {item.weight} · {item.tracking}%</code>
          </div>
          <div className="min-w-0 space-y-3 border-t border-border pt-4 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
            <p className="text-xs text-muted-foreground">{t('design_system.figmaFoundations.application')}</p>
            <p className={`break-words ${item.applicationClassName}`} style={{ fontFamily: applicationFont }}>{t('design_system.gallery.samples.typeSample')}</p>
            <code className="block text-xs text-muted-foreground">{item.applicationClassName}</code>
          </div>
        </div>
      </article>)}
    </div>
  </ReferencePage>
}

function RadiusReference() {
  const t = useT()
  return <ReferencePage name="Corner radius · 12 values" note="design_system.figmaFoundations.radiusNote">
    <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
      {radius.map(item => <article className="space-y-4 rounded-xl border border-border p-5" key={item.id} data-foundation="radius">
        <div className="flex items-baseline justify-between gap-2"><h2 className="text-sm font-semibold">{item.name}</h2><code className="text-xs">{item.pixels}px</code></div>
        <p className="text-xs text-muted-foreground">{t('design_system.figmaFoundations.reference')}</p>
        <div className="h-20 border-2 border-foreground bg-muted" style={{ borderRadius: item.pixels }} aria-hidden="true" />
        <p className="text-xs text-muted-foreground">{t('design_system.figmaFoundations.application')}</p>
        {item.applicationClassName ? <><div className={`h-20 border-2 border-foreground bg-muted ${item.applicationClassName}`} aria-hidden="true" /><code className="block text-xs">{item.applicationClassName}</code></> : <p className="flex h-20 items-center rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">{t('design_system.figmaFoundations.noEquivalent')}</p>}
        <SourceLink id={item.id} />
      </article>)}
    </div>
  </ReferencePage>
}

function ShadowReference() {
  const t = useT()
  return <ReferencePage name="Shadows · 13 effect stacks" note="design_system.figmaFoundations.shadowNote">
    <div className="grid gap-6 lg:grid-cols-2">
      {shadows.map(item => <article className="space-y-4 rounded-xl border border-border p-5" key={item.id} data-foundation="shadow">
        <h2 className="text-sm font-semibold">{item.name}</h2>
        <div className="grid grid-cols-2 gap-5">
          <div className="space-y-3"><p className="text-xs text-muted-foreground">{t('design_system.figmaFoundations.reference')}</p><div className="rounded-lg p-5" style={{ background: '#ffffff' }}><div className="h-24 rounded-lg" style={{ background: '#ffffff', boxShadow: item.css }} aria-hidden="true" /></div></div>
          <div className="space-y-3"><p className="text-xs text-muted-foreground">{t('design_system.figmaFoundations.currentToken')}</p>{item.applicationClassName ? <><div className="rounded-lg bg-background p-5"><div className={`h-24 rounded-lg bg-card ${item.applicationClassName}`} aria-hidden="true" /></div><code className="text-xs">{item.applicationClassName}</code></> : <p className="rounded-lg border border-dashed border-border p-4 text-xs text-muted-foreground">{t('design_system.figmaFoundations.noEquivalent')}</p>}</div>
        </div>
        <details className="rounded-md bg-muted/40 p-3"><summary className="cursor-pointer text-xs">box-shadow</summary><code className="mt-3 block break-words text-overline leading-5">{item.css}</code></details>
        <SourceLink id={item.id} />
      </article>)}
    </div>
  </ReferencePage>
}

function MotionReference() {
  const t = useT()
  const [active, setActive] = React.useState(false)
  const [focused, setFocused] = React.useState<number | null>(null)
  return <ReferencePage name="Motion · 5 durations" note="design_system.figmaFoundations.motionNote">
    <Button type="button" variant="outline" aria-pressed={active} onClick={() => setActive(value => !value)}>{t('design_system.figmaFoundations.toggleMotion')}</Button>
    <div className="space-y-5">
      {durations.map((item, index) => <article className="space-y-3 rounded-xl border border-border p-5" key={item.id} data-foundation="motion">
        <div className="flex flex-wrap items-baseline justify-between gap-3"><h2 className="text-sm font-semibold">{item.name} · {item.milliseconds} ms</h2><SourceLink id={item.id} /></div>
        <Button type="button" variant="ghost" className="h-auto w-full justify-start gap-6 border border-border p-4" onPointerEnter={() => setFocused(index)} onPointerLeave={() => setFocused(null)} onFocus={() => setFocused(index)} onBlur={() => setFocused(null)} onClick={() => setActive(value => !value)} aria-pressed={active}>
          <span className="w-24 shrink-0 text-left text-xs">{item.className}</span>
          <span aria-hidden="true" className={`block h-10 flex-1 rounded-md bg-primary transition-opacity ease-out motion-reduce:transition-none ${item.className} ${active || focused === index ? 'opacity-100' : 'opacity-20'}`} />
        </Button>
        <code className="block text-xs text-muted-foreground">transition-opacity {item.className} ease-out motion-reduce:transition-none</code>
      </article>)}
    </div>
  </ReferencePage>
}

function GridDiagram({ item }: { item: typeof grid[number] }) {
  const t = useT()
  const origin = item.sidebar + item.submenu + item.safe
  return <svg viewBox="0 0 1440 320" className="h-auto w-full rounded-md border border-border bg-background" role="img" aria-label={item.name}>
    {item.sidebar > 0 && <><rect width={item.sidebar} height="320" fill="var(--primary)" /><text x={item.sidebar / 2} y="150" textAnchor="middle" fontSize="16" fill="var(--primary-foreground)">{t('design_system.figmaFoundations.sidebar')}</text><text x={item.sidebar / 2} y="176" textAnchor="middle" fontSize="16" fill="var(--primary-foreground)">{item.sidebar} px</text></>}
    {item.submenu > 0 && <><rect x={item.sidebar} width={item.submenu} height="320" fill="var(--muted)" /><text x={item.sidebar + item.submenu / 2} y="150" textAnchor="middle" fontSize="16" fill="var(--foreground)">{t('design_system.figmaFoundations.submenu')}</text><text x={item.sidebar + item.submenu / 2} y="176" textAnchor="middle" fontSize="16" fill="var(--foreground)">{item.submenu} px</text></>}
    {Array.from({ length: 12 }, (_, index) => <g key={index}><rect x={origin + index * (item.column + item.gutter)} width={item.column} height="320" fill="var(--chart-indigo)" fillOpacity=".15" /><text x={origin + index * (item.column + item.gutter) + item.column / 2} y="150" textAnchor="middle" fontSize="16" fill="var(--foreground)">{String(index + 1).padStart(2, '0')}</text><text x={origin + index * (item.column + item.gutter) + item.column / 2} y="176" textAnchor="middle" fontSize="14" fill="var(--foreground)">{item.column}px</text></g>)}
  </svg>
}

function GridReference() {
  const t = useT()
  return <ReferencePage name="Grid system · 4 layouts" note="design_system.figmaFoundations.gridNote">
    <div className="space-y-8">
      {grid.map(item => <article className="space-y-5 rounded-xl border border-border p-5" key={item.id} data-foundation="grid">
        <div className="flex flex-wrap items-baseline justify-between gap-3"><h2 className="text-lg font-semibold">{item.name}</h2><SourceLink id={item.id} /></div>
        <GridDiagram item={item} />
        <dl className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">{[
          [t('design_system.figmaFoundations.columns'), `12 × ${item.column} px`],
          [t('design_system.figmaFoundations.gutter'), `${item.gutter} px`],
          [t('design_system.figmaFoundations.safeArea'), `${item.safe} px`],
          [t('design_system.figmaFoundations.sidebar'), `${item.sidebar + item.submenu} px`],
        ].map(([label, value]) => <div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 font-medium">{value}</dd></div>)}</dl>
        <p className="text-sm text-muted-foreground">{t('design_system.figmaFoundations.noGridEquivalent')}</p>
        <code className="block break-words text-xs">grid-cols-12 · gap-6{item.safe === 32 ? ' · px-8' : ''}</code>
      </article>)}
    </div>
  </ReferencePage>
}

function ColorReference() {
  const t = useT()
  const [query, setQuery] = React.useState('')
  const visible = colors.filter(item => `${item.role || ''} ${item.mode || ''} ${item.name} ${item.captions.join(' ')} ${item.hex}`.toLowerCase().includes(query.trim().toLowerCase()))
  return <ReferencePage name="Color palette · 358 swatches" note="design_system.figmaFoundations.colorNote">
    <SearchInput value={query} onChange={setQuery} aria-label={t('design_system.figmaFoundations.filterColors')} placeholder={t('design_system.figmaFoundations.filterColors')} className="max-w-xl" />
    <p className="text-xs text-muted-foreground">{visible.length} / {colors.length}</p>
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {visible.map(item => <article className="space-y-3 rounded-lg border border-border p-4" key={item.id} data-foundation="color">
        <div className="h-20 rounded-md border border-border bg-background"><div className="h-full w-full rounded-md" style={{ background: item.hex, opacity: item.opacity }} aria-hidden="true" /></div>
        <h2 className="break-words text-sm font-semibold">{item.role || item.name}</h2>
        {item.mode && <p className="text-xs text-muted-foreground">{item.mode} · {item.name}</p>}
        <p className="text-xs text-muted-foreground">{t('design_system.figmaFoundations.actualFill')} · <code>{item.hex}</code>{item.opacity < 1 ? ` · ${Math.round(item.opacity * 100)}%` : ''}</p>
        {!!item.captions.length && <code className="block break-words text-overline text-muted-foreground">{item.captions.join(' · ')}</code>}
        {item.mismatch && <p className="text-xs font-medium text-status-warning-text">{t('design_system.figmaFoundations.captionMismatch')}</p>}
        <SourceLink id={item.id} />
      </article>)}
    </div>
    {!visible.length && <p className="text-sm text-muted-foreground">{t('design_system.figmaFoundations.emptyResults')}</p>}
  </ReferencePage>
}

const meta = { title: 'Design system/Figma foundations', parameters: { layout: 'fullscreen' } } satisfies Meta
export default meta
type Story = StoryObj<typeof meta>
export const Typography: Story = { render: () => <TypographyReference /> }
export const CornerRadius: Story = { render: () => <RadiusReference /> }
export const Shadows: Story = { render: () => <ShadowReference /> }
export const Motion: Story = { render: () => <MotionReference /> }
export const GridSystem: Story = { render: () => <GridReference /> }
export const ColorPalette: Story = { render: () => <ColorReference /> }
