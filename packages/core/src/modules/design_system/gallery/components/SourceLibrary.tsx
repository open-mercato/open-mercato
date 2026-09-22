'use client'

import * as React from 'react'
import { GalleryLink as Link } from './GalleryLink'
import { ArrowRight } from 'lucide-react'
import { LinkButton } from '@open-mercato/ui/primitives/link-button'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { Pagination } from '@open-mercato/ui/primitives/pagination'
import { SearchInput } from '@open-mercato/ui/primitives/search-input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import { GALLERY_BASE_PATH } from '../registry'
import { sourceLibrary } from '../source-library.generated'

const pageSize = 12
const allGroups = '__all'
const groupTranslationKey = (group: string) => `design_system.gallery.sourceLibrary.groups.${group.toLowerCase().replace(/\s+/g, '-')}`

export function SourceLibrary() {
  const t = useT()
  const storyTitle = (story: { family: string; entryId: string; title: string }) => story.family === 'foundations'
    ? t(`design_system.foundations.${story.entryId}.title`, story.title)
    : story.title
  const [query, setQuery] = React.useState('')
  const [group, setGroup] = React.useState(allGroups)
  const [page, setPage] = React.useState(1)
  const groups = React.useMemo(() => Array.from(new Set(sourceLibrary.pages.map(item => item.group))), [])
  const needle = query.trim().toLowerCase()
  const filtered = sourceLibrary.pages.filter(item => {
    const matchesGroup = group === allGroups || item.group === group
    const translatedName = t(`design_system.gallery.sourceLibrary.names.${item.id}`, item.name)
    const translatedGroup = t(groupTranslationKey(item.group), item.group)
    const searchTerms = t(`design_system.gallery.sourceLibrary.searchTerms.${item.id}`, '')
    const searchable = `${item.name} ${translatedName} ${item.group} ${translatedGroup} ${searchTerms} ${item.stories.map(story => `${story.title} ${storyTitle(story)}`).join(' ')} ${item.sets.map(set => `${set.name} ${Object.values(set.axes).flat().join(' ')}`).join(' ')} ${item.standalone.map(asset => asset.name).join(' ')}`
    return matchesGroup && searchable.toLowerCase().includes(needle)
  })
  const visible = filtered.slice((page - 1) * pageSize, page * pageSize)

  return <div className="w-full min-w-0 space-y-4" data-example="native-source-library">
    <p className="text-sm text-muted-foreground">{t('design_system.gallery.sourceLibrary.boundary')}</p>
    <div className="flex flex-col gap-3 sm:flex-row">
      <SearchInput className="sm:flex-1" value={query} onChange={value => { setQuery(value); setPage(1) }} aria-label={t('design_system.gallery.sourceLibrary.search')} placeholder={t('design_system.gallery.sourceLibrary.search')} />
      <Select value={group} onValueChange={value => { setGroup(value); setPage(1) }}>
        <SelectTrigger className="w-full sm:w-64" aria-label={t('design_system.gallery.sourceLibrary.group')}><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value={allGroups}>{t('design_system.gallery.sourceLibrary.allGroups')}</SelectItem>
          {groups.map(value => <SelectItem key={value} value={value}>{t(groupTranslationKey(value), value)}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
    <p role="status" className="text-sm text-muted-foreground">{t('design_system.gallery.sourceLibrary.count', { visible: filtered.length, total: sourceLibrary.pages.length })}</p>
    {visible.length ? <div className="divide-y divide-border rounded-lg border border-border bg-card">{visible.map(item => {
      const variantCount = item.sets.reduce((total, set) => total + set.count, 0)
      const hasInventory = item.sets.length > 0 || item.standaloneCount > 0 || item.frameCount > 0
      return <article key={item.id} className="grid min-w-0 gap-4 p-5 lg:grid-cols-3">
        <header className="space-y-1">
          <h3 className="text-base font-semibold leading-tight">{t(`design_system.gallery.sourceLibrary.names.${item.id}`, item.name)}</h3>
          <p className="text-xs text-muted-foreground">{t(groupTranslationKey(item.group), item.group)}</p>
        </header>
        <div className="min-w-0 space-y-3 lg:col-span-2">
          {item.stories.length ? <ul className="flex flex-wrap gap-x-6 gap-y-3" aria-label={t('design_system.gallery.sourceLibrary.examples')}>
            {item.stories.map(story => <li key={`${story.family}:${story.entryId}`}>
              <LinkButton asChild variant="black">
                <Link href={`${GALLERY_BASE_PATH}?family=${story.family}&entry=${story.entryId}`}>
                  {storyTitle(story)}<ArrowRight className="size-4 text-muted-foreground" aria-hidden="true" />
                </Link>
              </LinkButton>
            </li>)}
          </ul> : <p className="text-sm text-muted-foreground">{t('design_system.gallery.sourceLibrary.referenceOnly')}</p>}
          {hasInventory ? <section className="text-sm">
            <h4 className="text-xs font-medium text-muted-foreground">{t('design_system.gallery.sourceLibrary.details')}</h4>
            <div className="mt-3 space-y-4 border-l border-border pl-4">
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                {item.sets.length ? <span>{t('design_system.gallery.sourceLibrary.componentSets', { count: item.sets.length })}</span> : null}
                {variantCount ? <span>{t('design_system.gallery.sourceLibrary.variants', { count: variantCount })}</span> : null}
                {item.frameCount ? <span>{t('design_system.gallery.sourceLibrary.frames', { count: item.frameCount })}</span> : null}
                {item.standaloneCount ? <span>{t('design_system.gallery.sourceLibrary.assets', { count: item.standaloneCount })}</span> : null}
              </div>
              {item.sets.map(set => <section key={set.id} className="space-y-2">
                <h4 className="text-sm font-medium">{set.name}</h4>
                <dl className="space-y-2">{Object.entries(set.axes).map(([axis, values]) => <div key={axis} className="text-xs"><dt className="font-medium">{axis}</dt><dd className="break-words text-muted-foreground">{(values as string[]).join(' · ')}</dd></div>)}</dl>
              </section>)}
            </div>
          </section> : null}
        </div>
      </article>
    })}</div> : <EmptyState title={t('design_system.gallery.noResults')} />}
    {filtered.length > pageSize ? <Pagination page={page} pageSize={pageSize} total={filtered.length} showPageSize={false} onPageChange={setPage} aria-label={t('design_system.gallery.sourceLibrary.pages')} /> : null}
  </div>
}
