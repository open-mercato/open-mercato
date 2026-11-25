'use client'

import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { galleryFamilies } from '@open-mercato/core/modules/design_system/gallery/registry'
import { FamilyEntryPreview } from '@open-mercato/core/modules/design_system/gallery/components/FamilyEntryPreview'
import type { GalleryEntry } from '@open-mercato/core/modules/design_system/gallery/types'
import { previewDictionary } from '@/lib/dictionaries'
import { entrySpecimen, firstExampleOnlyIds, thumbnailVariantIds, wideThumbnailIds } from './EntrySpecimens'

const dictionary = previewDictionary()
const familyLoads = new Map<string, Promise<GalleryEntry[]>>()

function loadFamilyEntries(familyId: string): Promise<GalleryEntry[]> {
  const cached = familyLoads.get(familyId)
  if (cached) return cached
  const family = galleryFamilies.find((candidate) => candidate.id === familyId)
  const pending = family ? family.load().then(({ entries }) => entries) : Promise.resolve([])
  familyLoads.set(familyId, pending)
  pending.catch(() => familyLoads.delete(familyId))
  return pending
}

function useNearViewport<T extends Element>(): [React.RefObject<T | null>, boolean] {
  const ref = React.useRef<T>(null)
  const [near, setNear] = React.useState(false)
  React.useEffect(() => {
    const node = ref.current
    if (!node || near) return
    if (typeof IntersectionObserver === 'undefined') {
      setNear(true)
      return
    }
    const observer = new IntersectionObserver((records) => {
      if (records.some((record) => record.isIntersecting)) setNear(true)
    }, { rootMargin: '400px 0px' })
    observer.observe(node)
    return () => observer.disconnect()
  }, [near])
  return [ref, near]
}

class ThumbnailBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? null : this.props.children
  }
}

const ZOOMED_WIDTH = 1.6
const MIN_SCALE = 0.45
const CROPPED_SCALE = 0.5

function FitToBox({ wide, children }: { wide: boolean; children: React.ReactNode }) {
  const contentRef = React.useRef<HTMLDivElement>(null)
  const [zoomed, setZoomed] = React.useState(wide)
  const [scale, setScale] = React.useState(1 / ZOOMED_WIDTH)
  const [cropped, setCropped] = React.useState(false)

  React.useLayoutEffect(() => {
    const content = contentRef.current
    const box = content?.parentElement
    if (!content || !box) return
    const measure = () => {
      const style = getComputedStyle(box)
      const availableHeight = box.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)
      const availableWidth = box.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
      if (!zoomed) {
        if (content.scrollHeight > availableHeight + 2 || content.scrollWidth > availableWidth + 2) setZoomed(true)
        return
      }
      const fit = Math.min(1 / ZOOMED_WIDTH, availableHeight / content.scrollHeight)
      const next = fit < MIN_SCALE ? CROPPED_SCALE : fit
      setCropped(fit < MIN_SCALE)
      setScale((current) => (Math.abs(current - next) < 0.01 ? current : next))
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(content)
    return () => observer.disconnect()
  }, [zoomed])

  return (
    <>
      <div
        ref={contentRef}
        className={`pointer-events-none flex min-w-0 shrink-0 flex-wrap items-center justify-center gap-3 select-none [&>*]:max-w-full ${cropped ? 'self-start' : ''}`}
        style={zoomed ? { width: `${ZOOMED_WIDTH * 100}%`, transform: `scale(${scale})`, transformOrigin: cropped ? 'top' : 'center' } : { width: '100%' }}
      >
        {children}
      </div>
      {cropped ? <span className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-muted to-transparent" /> : null}
    </>
  )
}

function ThumbnailContent({ entry }: { entry: GalleryEntry }) {
  const specimen = entrySpecimen(entry.id)
  if (specimen) return specimen
  const variant = entry.variants.find((candidate) => candidate.id === thumbnailVariantIds[entry.id])
  if (variant && firstExampleOnlyIds.has(entry.id)) return <div className="w-full max-w-xs [&>*]:!grid-cols-1 [&>*>*:not(:first-child)]:hidden">{variant.render()}</div>
  if (variant) return <>{variant.render()}</>
  return <FamilyEntryPreview entry={entry} />
}

export function EntryThumbnail({ familyId, entryId }: { familyId: string; entryId: string }) {
  const [ref, near] = useNearViewport<HTMLDivElement>()
  const [entry, setEntry] = React.useState<GalleryEntry | null>(null)
  const [queryClient] = React.useState(() => new QueryClient())

  React.useEffect(() => {
    if (!near) return
    let cancelled = false
    loadFamilyEntries(familyId)
      .then((entries) => {
        if (!cancelled) setEntry(entries.find((candidate) => candidate.id === entryId) ?? null)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [near, familyId, entryId])

  return (
    <div
      ref={ref}
      data-design-thumbnail=""
      aria-hidden="true"
      inert
      className="relative flex h-44 items-center justify-center overflow-hidden border-b border-border bg-muted/60 p-panel font-sans text-foreground"
    >
      {entry ? (
        <I18nProvider locale="en" dict={dictionary} supportedLocales={['en']}>
          <QueryClientProvider client={queryClient}>
            <ThumbnailBoundary>
              <FitToBox wide={wideThumbnailIds.has(entryId)}>
                <ThumbnailContent entry={entry} />
              </FitToBox>
            </ThumbnailBoundary>
          </QueryClientProvider>
        </I18nProvider>
      ) : (
        <span className="h-8 w-2/3 animate-pulse rounded-md bg-muted" />
      )}
    </div>
  )
}
