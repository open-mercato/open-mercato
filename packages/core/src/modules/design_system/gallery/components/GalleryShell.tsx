'use client'

import * as React from 'react'
import { useSearchParams } from 'next/navigation'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { SectionPage } from '@open-mercato/ui/backend/section-page'
import type { SectionNavGroup } from '@open-mercato/ui/backend/section-page'
import { buildDesignSystemSections, familyLabelFallback } from './sectionNav'
import { SearchInput } from '@open-mercato/ui/primitives/search-input'
import { Skeleton } from '@open-mercato/ui/primitives/skeleton'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { Button } from '@open-mercato/ui/primitives/button'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import type { GalleryEntry, GalleryFamily } from '../types'
import { GALLERY_BASE_PATH, galleryFamilies } from '../registry'
import { EntryCard } from './EntryCard'

function matchesQuery(entry: GalleryEntry, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  return entry.id.toLowerCase().includes(needle) || entry.title.toLowerCase().includes(needle)
}

type LoadedEntries = Record<string, GalleryEntry[]>

export function GalleryShell() {
  const t = useT()
  const searchParams = useSearchParams()
  const [loaded, setLoaded] = React.useState<LoadedEntries>({})
  const [failed, setFailed] = React.useState<Record<string, boolean>>({})
  const [search, setSearch] = React.useState('')
  const pendingRef = React.useRef(new Set<string>())

  const familyParam = searchParams?.get('family') ?? null
  const entryParam = searchParams?.get('entry') ?? null

  // Clicking a family in the section nav exits search mode — otherwise the
  // query keeps precedence and family navigation appears dead.
  React.useEffect(() => {
    setSearch('')
  }, [familyParam])
  const activeFamily: GalleryFamily | undefined =
    galleryFamilies.find((family) => family.id === familyParam) ?? galleryFamilies[0]
  const activeFamilyId = activeFamily?.id ?? null

  const loadFamily = React.useCallback((family: GalleryFamily) => {
    if (pendingRef.current.has(family.id)) return
    pendingRef.current.add(family.id)
    setFailed((prev) => (prev[family.id] ? { ...prev, [family.id]: false } : prev))
    family
      .load()
      .then((mod) => {
        setLoaded((prev) => (prev[family.id] ? prev : { ...prev, [family.id]: mod.entries }))
      })
      .catch(() => {
        pendingRef.current.delete(family.id)
        setFailed((prev) => ({ ...prev, [family.id]: true }))
      })
  }, [])

  // Lazy-load the active family; when searching, load every family so results
  // span the whole gallery.
  const searching = search.trim().length > 0
  React.useEffect(() => {
    if (searching) {
      for (const family of galleryFamilies) loadFamily(family)
    } else if (activeFamily) {
      loadFamily(activeFamily)
    }
  }, [searching, activeFamily, loadFamily])

  // Deep link: ?entry=<id> scrolls the entry into view once its family loaded.
  const activeEntries = activeFamilyId ? loaded[activeFamilyId] : undefined
  React.useEffect(() => {
    if (!entryParam || searching || !activeEntries) return
    const node = document.getElementById(`gallery-entry-${entryParam}`)
    node?.scrollIntoView({ block: 'start' })
  }, [entryParam, searching, activeEntries])

  const sections: SectionNavGroup[] = React.useMemo(() => buildDesignSystemSections(), [])

  const renderFamilySkeleton = () => (
    <div className="space-y-4" data-testid="gallery-family-skeleton">
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-40 w-full" />
    </div>
  )

  const renderSearchResults = () => {
    const groups = galleryFamilies
      .map((family) => ({
        family,
        entries: (loaded[family.id] ?? []).filter((entry) => matchesQuery(entry, search)),
      }))
      .filter((group) => group.entries.length > 0)
    const stillLoading = galleryFamilies.some((family) => !loaded[family.id] && !failed[family.id])
    if (groups.length === 0 && stillLoading) return renderFamilySkeleton()
    if (groups.length === 0) {
      return (
        <EmptyState
          title={t('design_system.gallery.noResults', 'No components match your search')}
        />
      )
    }
    return (
      <div className="space-y-8">
        {groups.map(({ family, entries }) => (
          <div key={family.id} className="space-y-4">
            <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
              {t(family.labelKey, familyLabelFallback(family.id))}
            </h2>
            {entries.map((entry) => (
              <EntryCard key={entry.id} entry={entry} />
            ))}
          </div>
        ))}
      </div>
    )
  }

  const renderActiveFamily = () => {
    if (!activeFamily) return null
    const entries = loaded[activeFamily.id]
    if (!entries && failed[activeFamily.id]) {
      return (
        <ErrorMessage
          label={t('design_system.gallery.loadFailed', 'Could not load this family')}
          action={
            <Button type="button" variant="outline" size="sm" onClick={() => loadFamily(activeFamily)}>
              {t('design_system.gallery.retry', 'Retry')}
            </Button>
          }
        />
      )
    }
    if (!entries) return renderFamilySkeleton()
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">
          {t(activeFamily.labelKey, familyLabelFallback(activeFamily.id))}
        </h2>
        {entries.map((entry) => (
          <EntryCard key={entry.id} entry={entry} />
        ))}
      </div>
    )
  }

  return (
    <SectionPage
      title="Design system"
      titleKey="design_system.nav.title"
      sections={sections}
      activePath={activeFamilyId ? `${GALLERY_BASE_PATH}?family=${activeFamilyId}` : GALLERY_BASE_PATH}
    >
      <div className="mx-auto w-full max-w-5xl space-y-6">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder={t('design_system.gallery.searchPlaceholder', 'Search components…')}
          aria-label={t('design_system.gallery.searchPlaceholder', 'Search components…')}
        />
        {searching ? renderSearchResults() : renderActiveFamily()}
      </div>
    </SectionPage>
  )
}
