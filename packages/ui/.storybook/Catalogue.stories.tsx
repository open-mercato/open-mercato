import { Component, useEffect, useRef, useState, type ReactNode } from 'react'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { ArrowRight, ArrowUpRight, BookOpen, Search } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Card } from '@open-mercato/ui/primitives/card'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { Label } from '@open-mercato/ui/primitives/label'
import { SearchInput } from '@open-mercato/ui/primitives/search-input'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { galleryFamilies } from '../../core/src/modules/design_system/gallery/registry'
import type { GalleryEntry } from '../../core/src/modules/design_system/gallery/types'
import catalogue from './generated/catalogue.generated.json'
import './catalogue.css'

type CatalogueEntry = {
  id: string
  title: string
  family: string
  familyTitle: string
  group: string
  description: string
  variantCount: number
  storyId: string
  figmaNodeId?: string
}

const entries: CatalogueEntry[] = catalogue
const groups = ['All', ...new Set(entries.map((entry) => entry.group))]
const totalVariants = entries.reduce((total, entry) => total + entry.variantCount, 0)
const familyCount = new Set(entries.map((entry) => entry.family)).size
const familyLoads = new Map<string, Promise<{ entries: GalleryEntry[] }>>()
const wideFamilies = new Set(['library', 'foundations', 'charts', 'filters', 'detail', 'scaffolding', 'notifications', 'schedule', 'messages'])

function storybookHref(path: string, globals: Record<string, unknown>): string {
  const parameters = new URLSearchParams({ path })
  parameters.set('globals', `theme:${globals.theme === 'dark' ? 'dark' : 'light'};font:${globals.font === 'figma' ? 'figma' : 'application'}`)
  return `./?${parameters.toString()}`
}

function loadFamily(familyId: string): Promise<{ entries: GalleryEntry[] }> {
  const cached = familyLoads.get(familyId)
  if (cached) return cached
  const family = galleryFamilies.find((candidate) => candidate.id === familyId)
  if (!family) return Promise.reject(new Error('[internal] Unknown catalogue family'))
  const pending = family.load().catch((error: unknown) => {
    familyLoads.delete(familyId)
    throw error
  })
  familyLoads.set(familyId, pending)
  return pending
}

class PreviewBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    return this.state.failed
      ? <p className="text-xs text-muted-foreground">Open the component to inspect its examples.</p>
      : this.props.children
  }
}

function ComponentPreview({ entry }: { entry: CatalogueEntry }) {
  const stageRef = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  const [component, setComponent] = useState<GalleryEntry | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    if (!('IntersectionObserver' in window)) {
      setVisible(true)
      return
    }
    const observer = new IntersectionObserver((observations) => {
      if (observations.some((observation) => observation.isIntersecting)) {
        setVisible(true)
        observer.disconnect()
      }
    })
    observer.observe(stage)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!visible) return
    let active = true
    loadFamily(entry.family).then((family) => {
      if (!active) return
      const match = family.entries.find((candidate) => candidate.id === entry.id)
      if (match) setComponent(match)
      else setFailed(true)
    }).catch(() => {
      if (active) setFailed(true)
    })
    return () => { active = false }
  }, [entry.family, entry.id, visible])

  const Render = component?.variants[0]?.render

  return (
    <div ref={stageRef} className="om-catalogue-preview" aria-hidden="true" inert>
      <PreviewBoundary>
        {Render ? (
          <div className={wideFamilies.has(entry.family) ? 'om-catalogue-specimen om-catalogue-specimen-wide' : 'om-catalogue-specimen'}>
            <Render />
          </div>
        ) : failed ? (
          <p className="text-xs text-muted-foreground">Preview unavailable. Open the component.</p>
        ) : <Spinner size="sm" />}
      </PreviewBoundary>
    </div>
  )
}

function ComponentCard({ entry, globals }: { entry: CatalogueEntry; globals: Record<string, unknown> }) {
  return (
    <Card className="om-catalogue-card gap-0 overflow-hidden py-0 shadow-none">
      <ComponentPreview entry={entry} />
      <div className="flex flex-1 flex-col gap-3 p-6">
        <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
          <span>{entry.familyTitle}</span>
          <span>{entry.variantCount} {entry.variantCount === 1 ? 'example' : 'examples'}</span>
        </div>
        <h3 className="text-base font-semibold">
          <a
            className="om-catalogue-entry-link flex items-center justify-between gap-3"
            href={storybookHref(`/story/${entry.storyId}`, globals)}
            target="_top"
          >
            {entry.title}
            <ArrowUpRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          </a>
        </h3>
        <p className="text-sm leading-6 text-muted-foreground">{entry.description}</p>
      </div>
    </Card>
  )
}

function ComponentCatalogue({ globals }: { globals: Record<string, unknown> }) {
  const [query, setQuery] = useState('')
  const [group, setGroup] = useState('All')
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const visibleEntries = entries.filter((entry) => (
    (group === 'All' || entry.group === group)
    && `${entry.title} ${entry.description} ${entry.familyTitle}`.toLocaleLowerCase().includes(normalizedQuery)
  ))

  return (
    <main className="om-catalogue">
      <header className="om-catalogue-hero">
        <div className="om-catalogue-intro">
          <p className="text-overline font-semibold uppercase tracking-widest text-muted-foreground">The component library</p>
          <h1 className="om-catalogue-title">Open Mercato</h1>
          <p className="text-2xl font-medium tracking-tight">Design system</p>
          <p className="mt-4 max-w-xl text-base leading-7 text-muted-foreground">
            Foundations, components and patterns for building Open Mercato.
            Explore the same UI that powers the application.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button asChild type="button">
              <a href={storybookHref('/docs/design-system-start-here--docs', globals)} target="_top">
                Get started <ArrowRight className="size-4" aria-hidden="true" />
              </a>
            </Button>
          </div>
        </div>
        <div className="om-catalogue-brand" aria-hidden="true">
          <div className="om-catalogue-brand-lime" />
          <div className="om-catalogue-brand-yellow" />
          <div className="om-catalogue-brand-violet" />
        </div>
        <dl className="om-catalogue-metrics">
          <div><dt>Components &amp; foundations</dt><dd>{entries.length}</dd></div>
          <div><dt>Variant examples</dt><dd>{totalVariants}</dd></div>
          <div><dt>Component families</dt><dd>{familyCount}</dd></div>
        </dl>
      </header>

      <section aria-labelledby="catalogue-heading" className="om-catalogue-library">
        <div className="om-catalogue-library-heading">
          <div>
            <h2 id="catalogue-heading" className="text-2xl font-semibold tracking-tight">Explore the library</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">Find a component, compare its examples and take it into your next screen.</p>
          </div>
          <a className="om-catalogue-text-link text-sm" href={storybookHref('/docs/design-system-coverage-and-gaps--docs', globals)} target="_top">
            Coverage &amp; gaps <ArrowUpRight className="size-4" aria-hidden="true" />
          </a>
        </div>

        <div className="om-catalogue-controls">
          <div className="om-catalogue-search space-y-2">
            <Label htmlFor="catalogue-search">Search the library</Label>
            <SearchInput id="catalogue-search" value={query} onChange={setQuery} placeholder="Button, date picker, chart…" clearLabel="Clear component search" />
          </div>
          <div role="group" aria-label="Component categories" className="flex flex-wrap gap-2">
            {groups.map((category) => (
              <Button
                key={category}
                type="button"
                size="sm"
                variant={category === group ? 'secondary' : 'ghost'}
                aria-pressed={category === group}
                onClick={() => setGroup(category)}
              >
                {category}
              </Button>
            ))}
          </div>
        </div>

        <p className="mb-4 text-xs text-muted-foreground" role="status" aria-live="polite">
          {visibleEntries.length} of {entries.length} entries
        </p>
        <div className="om-catalogue-grid">
          {visibleEntries.map((entry) => <ComponentCard key={entry.id} entry={entry} globals={globals} />)}
        </div>
        {visibleEntries.length === 0 ? (
          <EmptyState
            title="No matching components"
            description="Try another name or clear the category and search filters."
            icon={<Search className="size-6" aria-hidden="true" />}
            actions={<Button type="button" variant="outline" onClick={() => { setQuery(''); setGroup('All') }}>Clear filters</Button>}
          />
        ) : null}
      </section>

      <footer className="om-catalogue-footer">
        <BookOpen className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <p className="flex-1 text-sm leading-6 text-muted-foreground">
          This catalogue follows the code registry. Selected design foundations have been audited;
          a full component comparison is still pending.
        </p>
        <a className="om-catalogue-text-link text-sm" href={storybookHref('/docs/design-system-coverage-and-gaps--docs', globals)} target="_top">
          Review coverage <ArrowRight className="size-4" aria-hidden="true" />
        </a>
      </footer>
    </main>
  )
}

const meta = {
  title: 'Design system/Components',
  parameters: { layout: 'fullscreen', controls: { disable: true } },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>
export const Gallery: Story = { render: (_args, context) => <ComponentCatalogue globals={context.globals} /> }
