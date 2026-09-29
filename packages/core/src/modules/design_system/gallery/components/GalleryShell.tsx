'use client'

import * as React from 'react'
import { GalleryLink as Link, navigateGallery } from './GalleryLink'
import { ArrowLeft, Home, BookOpen, Grid2X2, Palette } from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { GalleryNavigation } from './GalleryNavigation'
import type { SectionNavGroup } from '@open-mercato/ui/backend/section-page'
import { SearchInput } from '@open-mercato/ui/primitives/search-input'
import { Skeleton } from '@open-mercato/ui/primitives/skeleton'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { Button } from '@open-mercato/ui/primitives/button'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import type { GalleryEntry, GalleryFamily } from '../types'
import { GALLERY_BASE_PATH, galleryFamilies } from '../registry'
import { EntryCard } from './EntryCard'
import { DesignSystemHome, DesignSystemPrinciples } from './DesignSystemHome'
import { StyleAgents } from './StyleAgents'
import { ComponentIndex } from './ComponentIndex'
import { FoundationGuide } from './FoundationGuide'
import { IconsBrowser } from './IconsBrowser'
import { fullWidthEntryIds } from '../presentation'

/** 'buttons' → 'Buttons' — untranslated fallback when a family labelKey has no message. */
function familyLabelFallback(id: string): string {
  return id.charAt(0).toUpperCase() + id.slice(1).replace(/[-_]/g, ' ')
}

function matchesQuery(entry: GalleryEntry, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  if (entry.id.toLowerCase().includes(needle) || entry.title.toLowerCase().includes(needle)) return true
  if (entry.keywords?.some((keyword) => keyword.toLowerCase().includes(needle))) return true
  // 'radiobutton' should still find 'radio' — match when the query CONTAINS the id/title too.
  return needle.includes(entry.id.toLowerCase()) || needle.includes(entry.title.toLowerCase())
}

/** A half-width card with no neighbour before the next full-width card would leave a hole, so it spans the row too. */
export function resolveFullWidthIds(entryIds: string[], fullWidthIds: ReadonlySet<string>): Set<string> {
  const resolved = new Set(entryIds.filter(id => fullWidthIds.has(id)))
  let unpaired: string | null = null
  for (const id of entryIds) {
    if (resolved.has(id)) {
      if (unpaired) resolved.add(unpaired)
      unpaired = null
    } else {
      unpaired = unpaired ? null : id
    }
  }
  if (unpaired) resolved.add(unpaired)
  return resolved
}

/**
 * The backend shell centres `main` once the viewport outgrows its max width, which would leave the
 * library navigation floating mid-screen. Pull the gallery back by that centring margin so the
 * navigation stays docked next to the application sidebar at every width.
 */
function useShellDockOffset(rootRef: React.RefObject<HTMLElement | null>): number {
  const [offset, setOffset] = React.useState(0)
  React.useLayoutEffect(() => {
    const main = rootRef.current?.closest('main')
    const column = main?.parentElement
    if (!main || !column || typeof ResizeObserver === 'undefined') return
    const measure = () => setOffset(Math.max(0, Math.round(main.getBoundingClientRect().left - column.getBoundingClientRect().left)))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(column)
    return () => observer.disconnect()
  }, [rootRef])
  return offset
}

type LoadedEntries = Record<string, GalleryEntry[]>

const componentFamilies = galleryFamilies.filter(family => !['foundations', 'library'].includes(family.id))

export function GalleryShell() {
  const t = useT()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [loaded, setLoaded] = React.useState<LoadedEntries>({})
  const [failed, setFailed] = React.useState<Record<string, boolean>>({})
  const [search, setSearch] = React.useState('')
  const pendingRef = React.useRef(new Set<string>())
  const rootRef = React.useRef<HTMLDivElement>(null)
  const dockOffset = useShellDockOffset(rootRef)

  const familyParam = searchParams?.get('family') ?? null
  const entryParam = searchParams?.get('entry') ?? null
  const variantParam = searchParams?.get('variant') ?? null
  const showingPrinciples = searchParams?.get('view') === 'principles' && !familyParam
  const showingComponents = searchParams?.get('view') === 'components' && !familyParam
  const showingStyleAgents = searchParams?.get('view') === 'style-agents' && !familyParam
  const showingHome = !familyParam && !showingPrinciples && !showingComponents && !showingStyleAgents
  const showingFoundations = familyParam === 'foundations'
  const showingAssets = familyParam === 'icons'
  const showingInventory = familyParam === 'library'
  const showingEntry = Boolean(entryParam) && !showingFoundations && !showingAssets && !showingInventory


  React.useEffect(() => {
    setSearch('')
  }, [familyParam, entryParam, showingPrinciples, showingComponents, showingStyleAgents])
  const activeFamily: GalleryFamily | undefined =
    galleryFamilies.find((family) => family.id === familyParam) ?? galleryFamilies[0]
  const activeFamilyId = activeFamily?.id ?? null
  const activeNavigationPath = showingStyleAgents ? `${GALLERY_BASE_PATH}?view=style-agents` : showingHome ? GALLERY_BASE_PATH : showingPrinciples ? `${GALLERY_BASE_PATH}?view=principles` : showingComponents ? `${GALLERY_BASE_PATH}?view=components` : `${GALLERY_BASE_PATH}?family=${activeFamilyId}${(showingFoundations || showingEntry) && entryParam ? `&entry=${entryParam}` : ''}`

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
    } else if (showingComponents) {
      for (const family of componentFamilies) loadFamily(family)
    } else if (activeFamily && !showingHome && !showingPrinciples && !showingStyleAgents) {
      loadFamily(activeFamily)
    }
  }, [searching, activeFamily, loadFamily, showingHome, showingPrinciples, showingComponents, showingStyleAgents])

  const activeEntries = activeFamilyId ? loaded[activeFamilyId] : undefined
  React.useEffect(() => {
    if (searching || (showingFoundations && entryParam && !activeEntries)) return
    const variantId = entryParam === 'file-upload' && variantParam === 'drag-and-drop' ? 'default' : variantParam
    const targetId = showingFoundations && entryParam ? `gallery-entry-${entryParam}` : entryParam && variantId && variantId !== '__all' ? `gallery-variant-${entryParam}-${variantId}` : 'gallery-page-heading'
    const node = document.getElementById(targetId) ?? document.getElementById('gallery-page-heading')
    node?.scrollIntoView({ block: 'start' })
  }, [familyParam, entryParam, variantParam, searching, activeEntries, showingFoundations, showingHome, showingPrinciples, showingComponents, showingStyleAgents])

  const sections: SectionNavGroup[] = React.useMemo(() => {
    const familyItem = (family: GalleryFamily) => ({
      id: family.id,
      label: familyLabelFallback(family.id),
      labelKey: family.labelKey,
      icon: family.icon,
      href: `${GALLERY_BASE_PATH}?family=${family.id}`,
      ...(!['library', 'icons'].includes(family.id) ? { children: (loaded[family.id] ?? []).map(entry => ({
        id: `entry:${entry.id}`, label: entry.title,
        ...(family.id === 'foundations' ? { labelKey: `design_system.foundations.${entry.id}.title` } : {}),
        href: `${GALLERY_BASE_PATH}?family=${family.id}&entry=${entry.id}`,
      })) } : {}),
    })
    return [
      { id: 'guide', label: '', items: [
        { id: '__home', label: 'Start', labelKey: 'design_system.portal.nav.home', icon: <Home className="size-4" />, href: GALLERY_BASE_PATH },
        { id: '__style-agents', label: 'Style agents', labelKey: 'design_system.styleAgents.title', icon: <Palette className="size-4" />, href: `${GALLERY_BASE_PATH}?view=style-agents` },
        ...galleryFamilies.filter(family => family.id === 'foundations').map(familyItem),
      ] },
      { id: 'families', label: 'Components', labelKey: 'design_system.portal.nav.components', items: [
        { id: '__components', label: 'All components', labelKey: 'design_system.gallery.navigation.allComponents', icon: <Grid2X2 className="size-4" />, href: `${GALLERY_BASE_PATH}?view=components` },
        ...componentFamilies.map(familyItem),
      ] },
      { id: 'resources', label: 'Resources', labelKey: 'design_system.gallery.navigation.resources', items: [
        { id: '__principles', label: 'Guidelines', labelKey: 'design_system.portal.nav.principles', icon: <BookOpen className="size-4" />, href: `${GALLERY_BASE_PATH}?view=principles` },
        ...galleryFamilies.filter(family => family.id === 'library').map(familyItem),
      ] },
    ]
  }, [loaded])
  const selectedEntry = entryParam ? activeEntries?.find(entry => entry.id === entryParam) : undefined
  const familyTitle = activeFamily ? t(activeFamily.labelKey, familyLabelFallback(activeFamily.id)) : t('design_system.nav.title')
  const pageTitle = showingComponents ? t('design_system.portal.nav.components') : showingEntry && selectedEntry ? selectedEntry.title : familyTitle

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
              <EntryCard key={entry.id} entry={entry} summary href={`${GALLERY_BASE_PATH}?family=${family.id}&entry=${entry.id}`} onNavigate={() => setSearch('')} />
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
    if (activeFamily.id === 'icons') return <IconsBrowser entryId={entryParam ?? undefined} variantId={variantParam ?? undefined} onNavigate={(entryId, variantId) => {
      const href = `${GALLERY_BASE_PATH}?family=icons&entry=${entryId}${variantId ? `&variant=${variantId}` : ''}`
      if (!navigateGallery(href)) router.push(href, { scroll: false })
    }} />
    if (activeFamily.id === 'foundations') return <FoundationGuide entries={entries} />
    const sourceLibraryRender = activeFamily.id === 'library' && entries.length === 1 && !entryParam
      ? entries[0]?.variants[0]?.render
      : undefined
    if (sourceLibraryRender) {
      const SourceLibraryRender = sourceLibraryRender
      return <div className="space-y-4">
        <SourceLibraryRender />
      </div>
    }
    const selectedEntry = entries.find(entry => entry.id === entryParam) ?? (entries.length === 1 ? entries[0] : undefined)
    const familyFullWidthIds = resolveFullWidthIds(entries.map(entry => entry.id), fullWidthEntryIds)
    return (
      <div className="space-y-4">
        {selectedEntry ? <>
          <EntryCard key={selectedEntry.id} entry={selectedEntry} hideTitle fullWidth={fullWidthEntryIds.has(selectedEntry.id)} />
        </> : <div className="grid grid-cols-1 gap-4 @3xl:grid-cols-2">{entries.map(entry => <EntryCard key={entry.id} entry={entry} summary summaryPreview fullWidth={familyFullWidthIds.has(entry.id)} href={`${GALLERY_BASE_PATH}?family=${activeFamily.id}&entry=${entry.id}`} />)}</div>}
      </div>
    )
  }

  return (
    <div ref={rootRef} className="flex min-w-0 flex-col lg:flex-row" style={dockOffset ? { marginLeft: -dockOffset, width: `calc(100% + ${dockOffset}px)` } : undefined}>
      <GalleryNavigation sections={sections} activePath={activeNavigationPath} activeFamilyId={familyParam} onNavigate={() => setSearch('')} failed={failed} onExpand={id => {
        const family = galleryFamilies.find(family => family.id === id)
        if (family) loadFamily(family)
      }} onRetry={id => {
        const family = galleryFamilies.find(family => family.id === id)
        if (family) loadFamily(family)
      }} />
      <div className="min-w-0 flex-1 py-4 lg:pl-6">
      <div className="@container mx-auto w-full max-w-6xl space-y-6">
        {showingStyleAgents ? <StyleAgents /> : showingHome ? <DesignSystemHome /> : showingPrinciples ? <div id="gallery-page-heading" className="scroll-mt-36 lg:scroll-mt-24 space-y-8 py-8"><h1 className="text-3xl font-medium tracking-tight">{t('design_system.portal.nav.principles')}</h1><DesignSystemPrinciples /></div> : <>
        <header id="gallery-page-heading" className="scroll-mt-36 lg:scroll-mt-24 space-y-3">
          {selectedEntry && showingEntry ? <Button asChild variant="outline" size="sm"><Link href={`${GALLERY_BASE_PATH}?family=${activeFamilyId}`}><ArrowLeft aria-hidden />{t('design_system.gallery.backToNamedFamily', { family: familyTitle })}</Link></Button> : null}
          {!showingComponents && (!selectedEntry || !showingEntry) ? <Button asChild variant="outline" size="sm"><Link href={`${GALLERY_BASE_PATH}?view=components`}><ArrowLeft aria-hidden />{t('design_system.gallery.backToNamedFamily', { family: t('design_system.portal.nav.components') })}</Link></Button> : null}
          <h1 className="text-3xl font-semibold tracking-tight">{pageTitle}</h1>
          {showingEntry && selectedEntry?.descriptionKey ? <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">{t(selectedEntry.descriptionKey)}</p> : null}
          {showingComponents ? <p className="text-base text-muted-foreground">{t('design_system.portal.componentsDescription')}</p> : null}
        </header>
        {!showingAssets && !showingInventory && !showingEntry ? <SearchInput
          value={search}
          onChange={setSearch}
          placeholder={t('design_system.gallery.searchPlaceholder', 'Search components…')}
          aria-label={t('design_system.gallery.searchPlaceholder', 'Search components…')}
        /> : null}
        {searching ? renderSearchResults() : showingComponents ? <ComponentIndex families={componentFamilies} loaded={loaded} failed={failed} onRetry={loadFamily} /> : renderActiveFamily()}
        </>}
      </div>
      </div>
    </div>
  )
}
