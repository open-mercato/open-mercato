'use client'

import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nProvider, useT } from '@open-mercato/shared/lib/i18n/context'
import { FlashMessages } from '@open-mercato/ui/backend/FlashMessages'
import { galleryFamilies } from '@open-mercato/core/modules/design_system/gallery/registry'
import { fullWidthEntryIds } from '@open-mercato/core/modules/design_system/gallery/presentation'
import type { GalleryVariant } from '@open-mercato/core/modules/design_system/gallery/types'
import { previewDictionary } from '@/lib/dictionaries'
import { PREVIEW_HEIGHT_MESSAGE, previewContentHeight } from '@/lib/preview-protocol'

type PreviewRendererProps = {
  familyId: string
  entryId: string
  variantId: string
}

type LoadState = { status: 'loading' } | { status: 'missing' } | { status: 'ready'; variant: GalleryVariant }

const dictionary = previewDictionary()

function VariantBody({ entryId, variant }: { entryId: string; variant: GalleryVariant }) {
  const ref = React.useRef<HTMLDivElement>(null)
  const [grouped, setGrouped] = React.useState(false)
  const fullWidth = fullWidthEntryIds.has(entryId)

  React.useLayoutEffect(() => {
    const node = ref.current
    if (!node || fullWidth) return
    const measure = () => setGrouped(node.childElementCount > 1)
    measure()
    const observer = new MutationObserver(measure)
    observer.observe(node, { childList: true })
    return () => observer.disconnect()
  }, [fullWidth, variant])

  const layout = grouped && !fullWidth ? 'flow' : 'full'
  return (
    <div ref={ref} data-preview-layout={layout} className={layout === 'flow' ? 'flex min-w-0 flex-wrap items-start gap-4 *:min-w-0' : 'min-w-0'}>
      {variant.render()}
    </div>
  )
}

function PreviewBody({ familyId, entryId, variantId }: PreviewRendererProps) {
  const t = useT()
  const contentRef = React.useRef<HTMLDivElement>(null)
  const [state, setState] = React.useState<LoadState>({ status: 'loading' })

  React.useEffect(() => {
    let cancelled = false
    const family = galleryFamilies.find((candidate) => candidate.id === familyId)
    if (!family) {
      setState({ status: 'missing' })
      return
    }
    family
      .load()
      .then(({ entries }) => {
        if (cancelled) return
        const variant = entries.find((entry) => entry.id === entryId)?.variants.find((candidate) => candidate.id === variantId)
        setState(variant ? { status: 'ready', variant } : { status: 'missing' })
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'missing' })
      })
    return () => {
      cancelled = true
    }
  }, [familyId, entryId, variantId])

  React.useEffect(() => {
    const node = contentRef.current
    if (!node || window.parent === window) return
    let frame = 0
    const post = () => {
      frame = 0
      window.parent.postMessage({ type: PREVIEW_HEIGHT_MESSAGE, height: previewContentHeight(node, document) }, window.location.origin)
    }
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(post)
    }
    post()
    const resizeObserver = new ResizeObserver(schedule)
    resizeObserver.observe(node)
    const mutationObserver = new MutationObserver(schedule)
    mutationObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-state', 'style'] })
    return () => {
      resizeObserver.disconnect()
      mutationObserver.disconnect()
      if (frame) window.cancelAnimationFrame(frame)
    }
  }, [])

  return (
    <div ref={contentRef} className="bg-background p-4 font-sans text-foreground sm:p-6">
      {state.status === 'ready' ? <VariantBody entryId={entryId} variant={state.variant} /> : null}
      {state.status === 'loading' ? <p className="text-sm text-muted-foreground">{t('design.preview.loading')}</p> : null}
      {state.status === 'missing' ? <p className="text-sm text-muted-foreground">{t('design.preview.notFound')}</p> : null}
    </div>
  )
}

export function PreviewRenderer(props: PreviewRendererProps) {
  const [client] = React.useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } }),
  )
  return (
    <QueryClientProvider client={client}>
      <I18nProvider locale="en" dict={dictionary} supportedLocales={['en']}>
        <PreviewBody {...props} />
        <FlashMessages />
      </I18nProvider>
    </QueryClientProvider>
  )
}
