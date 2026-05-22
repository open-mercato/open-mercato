"use client"

import * as React from 'react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { EmbeddedForm } from '../../../ui/public'

/**
 * External website embed host page (spec `2026-05-21-forms-render-surfaces.md`,
 * S4 / D4–D6). Rendered INSIDE a third-party iframe injected by the embed
 * loader script. It mounts the chrome-stripped `<EmbeddedForm>` over the
 * existing anonymous open-link flow — no portal/site navigation, no app shell.
 *
 * Behaviour:
 *  - Reuses the `/api/forms/public/*` anonymous lifecycle verbatim; a closed,
 *    capped, auth-required, or non-embeddable distribution renders the
 *    `<EmbeddedForm>` unavailable / auth-required state.
 *  - Applies the distribution's configured `settings.embed.theme`
 *    (`light` / `dark` / `auto`) inside the iframe by toggling the `.dark`
 *    class on the document root (the app's Tailwind dark variant is
 *    `&:is(.dark *)`). `auto` follows `prefers-color-scheme`.
 *  - When `settings.embed.autoResize !== false`, posts
 *    `{ type: 'om-forms:resize', height }` to `window.parent` via a debounced
 *    `ResizeObserver`, only on a height delta, and ONLY to the concrete ancestor
 *    origin (never `'*'`) — so the message reaches exactly the framing site and
 *    nothing else (R-RS-4 / R-RS-5).
 *
 * SECURITY (R-RS-1) — frame-ancestors header:
 *   The browser-enforced clickjacking gate for this route is the response
 *   header `Content-Security-Policy: frame-ancestors <allowedDomains>` together
 *   with the ABSENCE of `X-Frame-Options`. That header is per-distribution and
 *   is applied by the app proxy/middleware (`apps/mercato/src/proxy.ts`), which
 *   resolves it from `GET /api/forms/public/distributions/:slug/embed-policy`
 *   (→ `buildFrameAncestorsCsp(readEmbedSettings(...))` in
 *   `lib/embed-frame-policy.ts`). The global app frame protection in
 *   `apps/mercato/next.config.ts` excludes `/embed/`, so the middleware is the
 *   sole authority here and fails closed (`frame-ancestors 'none'`) for
 *   non-embeddable / unknown slugs.
 */
type EmbedPresentation = {
  theme: 'light' | 'dark' | 'auto'
  autoResize: boolean
}

type DistributionEmbedContext = {
  embed?: { theme?: 'light' | 'dark' | 'auto' | null; autoResize?: boolean | null } | null
}

export default function EmbedHostPage({ params }: { params?: { slug?: string } }) {
  const slug = params?.slug ?? ''
  const [presentation, setPresentation] = React.useState<EmbedPresentation | null>(null)
  const autoResizeRef = React.useRef(true)

  // Resolve the distribution's embed presentation settings (theme / autoResize).
  React.useEffect(() => {
    if (!slug) return
    let cancelled = false
    apiCall<DistributionEmbedContext>(
      `/api/forms/public/distributions/${encodeURIComponent(slug)}`,
    )
      .then((res) => {
        if (cancelled) return
        const embed = res.ok ? res.result?.embed : null
        const next: EmbedPresentation = {
          theme: embed?.theme ?? 'auto',
          autoResize: embed?.autoResize !== false,
        }
        autoResizeRef.current = next.autoResize
        setPresentation(next)
      })
      .catch(() => {
        if (cancelled) return
        autoResizeRef.current = true
        setPresentation({ theme: 'auto', autoResize: true })
      })
    return () => {
      cancelled = true
    }
  }, [slug])

  // Apply the configured theme to the iframe document root.
  React.useEffect(() => {
    if (typeof document === 'undefined' || !presentation) return
    const root = document.documentElement
    const apply = (dark: boolean) => root.classList.toggle('dark', dark)
    if (presentation.theme === 'dark') {
      apply(true)
      return
    }
    if (presentation.theme === 'light') {
      apply(false)
      return
    }
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    apply(mediaQuery.matches)
    const onChange = (event: MediaQueryListEvent) => apply(event.matches)
    mediaQuery.addEventListener('change', onChange)
    return () => mediaQuery.removeEventListener('change', onChange)
  }, [presentation])

  // Auto-resize: report content height to the framing site (gated by autoResize).
  React.useEffect(() => {
    if (typeof window === 'undefined') return
    if (window.parent === window) return

    const ancestorOrigin = resolveAncestorOrigin()
    if (!ancestorOrigin) return

    let lastHeight = -1
    let frame = 0

    const postHeight = () => {
      frame = 0
      if (!autoResizeRef.current) return
      const height = Math.ceil(document.documentElement.scrollHeight)
      if (height === lastHeight) return
      lastHeight = height
      window.parent.postMessage({ type: 'om-forms:resize', height }, ancestorOrigin)
    }

    const scheduleHeight = () => {
      if (frame) return
      frame = window.requestAnimationFrame(postHeight)
    }

    const observer = new ResizeObserver(scheduleHeight)
    observer.observe(document.documentElement)
    scheduleHeight()

    return () => {
      observer.disconnect()
      if (frame) window.cancelAnimationFrame(frame)
    }
  }, [])

  if (!slug) return null

  return (
    <div className="min-h-0 bg-background p-4" data-om-embed-host="">
      <EmbeddedForm source={{ kind: 'distribution', slug }} />
    </div>
  )
}

/**
 * Best-effort resolution of the single ancestor (framing site) origin so resize
 * messages are posted to a concrete origin instead of `'*'`. Prefers the
 * browser-maintained `ancestorOrigins` list; falls back to the referrer origin.
 * Returns `null` when no cross-origin ancestor can be determined — in which case
 * no resize message is posted (fail-closed).
 */
function resolveAncestorOrigin(): string | null {
  const ancestorOrigins = window.location.ancestorOrigins
  if (ancestorOrigins && ancestorOrigins.length > 0) {
    const top = ancestorOrigins[ancestorOrigins.length - 1]
    if (top) return top
  }
  if (document.referrer) {
    try {
      return new URL(document.referrer).origin
    } catch {
      return null
    }
  }
  return null
}
