'use client'

import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nProvider, useT } from '@open-mercato/shared/lib/i18n/context'
import { FlashMessages } from '@open-mercato/ui/backend/FlashMessages'
import { galleryFamilies } from '@open-mercato/core/modules/design_system/gallery/registry'
import type { GalleryVariant } from '@open-mercato/core/modules/design_system/gallery/types'
import { previewDictionary } from '@/lib/dictionaries'
import { PREVIEW_HEIGHT_MESSAGE } from '@/lib/preview-protocol'

type PreviewRendererProps = {
  familyId: string
  entryId: string
  variantId: string
}

type LoadState = { status: 'loading' } | { status: 'missing' } | { status: 'ready'; variant: GalleryVariant }

const dictionary = previewDictionary()

function applyQuery(): void {
  const query = new URLSearchParams(window.location.search)
  const root = document.documentElement
  const mode = query.get('mode') === 'dark' ? 'dark' : 'light'
  root.classList.toggle('dark', mode === 'dark')
  root.style.colorScheme = mode
  if (query.get('theme') === 'storefront') root.dataset.theme = 'storefront'
  else delete root.dataset.theme
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
    const post = () => {
      window.parent.postMessage({ type: PREVIEW_HEIGHT_MESSAGE, height: node.getBoundingClientRect().height }, window.location.origin)
    }
    post()
    const observer = new ResizeObserver(post)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  return (
    <div ref={contentRef} className="p-4 sm:p-6">
      {state.status === 'ready' ? state.variant.render() : null}
      {state.status === 'loading' ? <p className="text-sm text-muted-foreground">{t('design.preview.loading')}</p> : null}
      {state.status === 'missing' ? <p className="text-sm text-muted-foreground">{t('design.preview.notFound')}</p> : null}
    </div>
  )
}

export function PreviewRenderer(props: PreviewRendererProps) {
  const [client] = React.useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } }),
  )
  React.useLayoutEffect(() => {
    applyQuery()
  }, [])
  return (
    <QueryClientProvider client={client}>
      <I18nProvider locale="en" dict={dictionary} supportedLocales={['en']}>
        <PreviewBody {...props} />
        <FlashMessages />
      </I18nProvider>
    </QueryClientProvider>
  )
}
