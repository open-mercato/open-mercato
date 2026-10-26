import { useMemo, useState } from 'react'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { ChevronDown } from 'lucide-react'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { SearchInput } from '@open-mercato/ui/primitives/search-input'
import library from './generated/figma-library.generated.json'

type SetRecord = { id: string; name: string; count: number; axes: Record<string, string[]> }
type PageRecord = {
  id: string; name: string; group: string; inspected: boolean; contextRead: boolean
  baselineGap: string | null
  sets: SetRecord[]; standaloneCount: number; frameCount: number
  standalone: { id: string; name: string }[]
  stories: { title: string; storyId: string; variantCount: number }[]
}
const pages: PageRecord[] = library.pages
const groups = ['All', ...new Set(pages.map(page => page.group))]

function FigmaLibrary({ globals }: { globals: Record<string, unknown> }) {
  const [query, setQuery] = useState('')
  const [group, setGroup] = useState('All')
  const [gapsOnly, setGapsOnly] = useState(false)
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    return pages.filter(page => (group === 'All' || page.group === group)
      && (!gapsOnly || page.stories.length === 0)
      && `${page.name} ${page.sets.map(set => `${set.name} ${Object.values(set.axes).flat().join(' ')}`).join(' ')} ${page.standalone.map(node => node.name).join(' ')}`.toLocaleLowerCase().includes(needle))
  }, [query, group, gapsOnly])
  const storyHref = (storyId: string) => `./?${new URLSearchParams({ path: `/story/${storyId}`, globals: `theme:${globals.theme === 'dark' ? 'dark' : 'light'};font:${globals.font === 'figma' ? 'figma' : 'application'}` })}`
  return (
    <main className="mx-auto flex max-w-7xl flex-col gap-8 px-5 py-10 sm:px-10">
      <header className="max-w-3xl space-y-4">
        <p className="text-overline font-semibold uppercase tracking-widest text-muted-foreground">Design reference · 12 September 2026</p>
        <h1 className="text-4xl font-semibold tracking-tight">The complete source library</h1>
        <p className="text-base leading-7 text-muted-foreground">Browse every design page, component set and variant axis in DS — Open Mercato and compare the related working examples locally.</p>
        <p className="rounded-lg border border-border bg-muted/40 p-4 text-sm leading-6">An example link means a related component exists. It does not mean every Figma variant is implemented or visually matched. Pages without examples remain visible here.</p>
      </header>
      <dl className="grid grid-cols-2 gap-4 border-y border-border py-6 md:grid-cols-4">
        {[
          ['Design pages', pages.length],
          ['Component sets', pages.reduce((n, page) => n + page.sets.length, 0)],
          ['Figma variants', pages.reduce((n, page) => n + page.sets.reduce((sum, set) => sum + set.count, 0), 0)],
          ['Pages without examples', pages.filter(page => !page.stories.length).length],
        ].map(([label, count]) => <div key={label}><dt className="text-sm text-muted-foreground">{label}</dt><dd className="mt-2 text-3xl font-semibold tabular-nums">{count}</dd></div>)}
      </dl>
      <section aria-label="Filter Figma library" className="flex flex-col gap-4">
        <SearchInput className="max-w-xl" aria-label="Search Figma library" placeholder="Search pages, sets or variant values…" value={query} onChange={setQuery} clearable />
        <div className="flex flex-wrap gap-2">
          {groups.map(value => <Button key={value} type="button" size="sm" variant={group === value ? 'default' : 'outline'} aria-pressed={group === value} onClick={() => setGroup(value)}>{value}</Button>)}
          <Button type="button" size="sm" variant={gapsOnly ? 'secondary' : 'ghost'} aria-pressed={gapsOnly} onClick={() => setGapsOnly(value => !value)}>Without examples</Button>
        </div>
        <p role="status" className="text-sm text-muted-foreground">{filtered.length} of {pages.length} pages</p>
      </section>
      <section aria-label="Figma pages" className="space-y-3">
        {filtered.map(page => (
          <details key={page.id} className="group rounded-xl border border-border bg-card text-card-foreground">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-xl p-5 outline-none focus-visible:shadow-focus [&::-webkit-details-marker]:hidden">
              <div className="min-w-0 space-y-1"><p className="text-xs text-muted-foreground">{page.group}</p><h2 className="text-base font-semibold">{page.name}</h2><p className="text-xs text-muted-foreground">{page.sets.length} sets · {page.sets.reduce((n, set) => n + set.count, 0)} variants</p></div>
              <div className="flex shrink-0 items-center gap-3"><Badge variant={page.stories.length ? 'neutral' : 'warning'}>{page.stories.length ? 'Related examples' : 'No examples'}</Badge><ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden="true" /></div>
            </summary>
            <div className="space-y-6 border-t border-border p-5">
              <p className="text-sm text-muted-foreground">{page.inspected ? 'Structure inspected' : 'Structure still needs inspection'} · {page.contextRead ? 'Representative design inspected' : 'Design comparison pending'}</p>
              {!!page.stories.length && <div className="space-y-2"><h3 className="text-sm font-medium">Related working examples</h3><div className="flex flex-wrap gap-2">{page.stories.map(story => <Button asChild type="button" size="sm" variant="outline" key={story.storyId}><a href={storyHref(story.storyId)} target="_top">{story.title} · {story.variantCount}</a></Button>)}</div></div>}
              {page.baselineGap && <div className="rounded-lg bg-muted/50 p-4 text-sm leading-6"><h3 className="mb-1 font-medium">Differences found in the audit</h3><p className="text-muted-foreground">{page.baselineGap}</p></div>}
              {page.sets.map(set => <article key={set.id} className="space-y-3 border-t border-border pt-4"><div className="flex flex-wrap items-baseline justify-between gap-2"><h3 className="text-sm font-semibold">{set.name}</h3><span className="text-xs text-muted-foreground">{set.count} source variants</span></div><dl className="space-y-2">{Object.entries(set.axes).map(([axis, values]) => <div className="grid gap-1 text-sm sm:grid-cols-[12rem_1fr]" key={axis}><dt className="font-medium">{axis}</dt><dd className="leading-6 text-muted-foreground">{values.join(' · ')}</dd></div>)}</dl></article>)}
              {!page.sets.length && <p className="text-sm leading-6 text-muted-foreground">This page contains foundations, assets or composed screens rather than variant sets. {page.frameCount > 0 && `${page.frameCount} top-level frames inventoried.`} {page.standaloneCount > 0 && `${page.standaloneCount} standalone components inventoried.`}</p>}
              {!!page.standalone.length && <div className="space-y-3 border-t border-border pt-4"><h3 className="text-sm font-medium">Standalone components and assets · {page.standalone.length}</h3><ul className="grid list-none gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">{page.standalone.map(node => <li className="min-w-0 break-words text-sm text-muted-foreground" key={node.id}>{node.name}</li>)}</ul></div>}
            </div>
          </details>
        ))}
        {!filtered.length && <p className="py-10 text-sm text-muted-foreground">No matching pages. Try another component name or clear the filters.</p>}
      </section>
    </main>
  )
}
const meta = { title: 'Design system/Figma library', parameters: { layout: 'fullscreen' } } satisfies Meta
export default meta
type Story = StoryObj<typeof meta>
export const Library: Story = { render: (_, context) => <FigmaLibrary globals={context.globals} /> }
