'use client'

import * as React from 'react'
import { GalleryLink as Link } from './GalleryLink'
import { ChevronDown } from 'lucide-react'
import { LinkButton } from '@open-mercato/ui/primitives/link-button'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { SearchInput } from '@open-mercato/ui/primitives/search-input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import { GALLERY_BASE_PATH } from '../registry'
import { sourceLibrary } from '../source-library.generated'

const allGroups = '__all'
const groupTranslationKey = (group: string) => `design_system.gallery.sourceLibrary.groups.${group.toLowerCase().replace(/\s+/g, '-')}`
const plainLabel = (value: string) => value.replace(/[\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}\u{FE0F}\u{200D}]/gu, '').replace(/\s+/g, ' ').trim()

type SourcePage = (typeof sourceLibrary.pages)[number]

export function SourceLibrary() {
  const t = useT()
  const storyTitle = (story: { family: string; entryId: string; title: string }) => story.family === 'foundations'
    ? t(`design_system.foundations.${story.entryId}.title`, story.title)
    : story.title
  const [query, setQuery] = React.useState('')
  const [group, setGroup] = React.useState(allGroups)
  const [expanded, setExpanded] = React.useState<ReadonlySet<string>>(new Set())
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
  const sections = groups
    .map(value => ({ group: value, items: filtered.filter(item => item.group === value) }))
    .filter(section => section.items.length > 0)
  const toggle = (id: string) => setExpanded(current => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })
  const summary = (item: SourcePage) => {
    const variantCount = item.sets.reduce((total, set) => total + set.count, 0)
    return [
      item.sets.length ? t('design_system.gallery.sourceLibrary.componentSets', { count: item.sets.length }) : null,
      variantCount ? t('design_system.gallery.sourceLibrary.variants', { count: variantCount }) : null,
      item.standaloneCount ? t('design_system.gallery.sourceLibrary.assets', { count: item.standaloneCount }) : null,
    ].filter(Boolean).join(', ')
  }

  return <div className="w-full min-w-0 space-y-6" data-example="native-source-library">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <SearchInput className="sm:flex-1" value={query} onChange={setQuery} aria-label={t('design_system.gallery.sourceLibrary.search')} placeholder={t('design_system.gallery.sourceLibrary.search')} />
      <Select value={group} onValueChange={setGroup}>
        <SelectTrigger className="w-full sm:w-56" aria-label={t('design_system.gallery.sourceLibrary.group')}><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value={allGroups}>{t('design_system.gallery.sourceLibrary.allGroups')}</SelectItem>
          {groups.map(value => <SelectItem key={value} value={value}>{t(groupTranslationKey(value), value)}</SelectItem>)}
        </SelectContent>
      </Select>
      <p role="status" className="shrink-0 text-sm text-muted-foreground">{t('design_system.gallery.sourceLibrary.count', { visible: filtered.length, total: sourceLibrary.pages.length })}</p>
    </div>
    {sections.length ? sections.map(section => <section key={section.group} aria-label={t(groupTranslationKey(section.group), section.group)}>
      <h3 className="flex items-baseline gap-2 border-b border-border pb-2 text-sm text-muted-foreground">
        {t(groupTranslationKey(section.group), section.group)}
        <span className="tabular-nums">{section.items.length}</span>
      </h3>
      <ul className="divide-y divide-border">{section.items.map(item => {
        const open = expanded.has(item.id)
        const name = t(`design_system.gallery.sourceLibrary.names.${item.id}`, item.name)
        const detailsId = `source-library-details-${item.id}`
        return <li key={item.id} className="py-2">
          <div className="flex min-h-8 flex-col gap-x-6 gap-y-1 sm:flex-row sm:items-center">
            <span className="shrink-0 text-sm text-foreground sm:w-48">{name}</span>
            <ul className="flex min-w-0 flex-1 flex-wrap gap-x-4 gap-y-1" aria-label={t('design_system.gallery.sourceLibrary.examples')}>
              {item.stories.map(story => <li key={`${story.family}:${story.entryId}`}>
                <LinkButton asChild variant="black" underline="always" className="decoration-border hover:decoration-foreground">
                  <Link href={`${GALLERY_BASE_PATH}?family=${story.family}&entry=${story.entryId}`}>{storyTitle(story)}</Link>
                </LinkButton>
              </li>)}
            </ul>
            <span className="flex shrink-0 items-center gap-2 text-sm tabular-nums text-muted-foreground">
              {summary(item)}
              {item.sets.length ? <IconButton type="button" size="sm" variant="ghost" aria-expanded={open} aria-controls={detailsId} aria-label={`${t('design_system.gallery.sourceLibrary.details')}: ${name}`} onClick={() => toggle(item.id)}>
                <ChevronDown className={open ? 'rotate-180 transition-transform' : 'transition-transform'} aria-hidden="true" />
              </IconButton> : <span className="hidden size-7 sm:block" aria-hidden="true" />}
            </span>
          </div>
          {open ? <div id={detailsId} className="space-y-3 pb-2 pt-3 sm:pl-48 sm:ml-6">
            {item.sets.map(set => <dl key={set.id} className="space-y-1 text-sm">
              <dt className="text-foreground">{plainLabel(set.name)}</dt>
              {Object.entries(set.axes).map(([axis, values]) => <dd key={axis} className="break-words text-muted-foreground"><span className="text-foreground">{plainLabel(axis)}</span> {(values as string[]).map(plainLabel).filter(Boolean).join(', ')}</dd>)}
            </dl>)}
          </div> : null}
        </li>
      })}</ul>
    </section>) : <EmptyState title={t('design_system.gallery.noResults')} />}
  </div>
}
