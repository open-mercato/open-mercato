import type { ReactNode } from 'react'
import React from 'react'

export type AdminNavItem = {
  group: string
  title: string
  href: string
  enabled: boolean
  order?: number
  priority?: number
  icon?: ReactNode
  children?: AdminNavItem[]
}

export async function buildAdminNav(
  modules: any[],
  ctx: { auth?: { roles?: string[]; sub?: string; orgId?: string | null; tenantId?: string | null }; path?: string },
  userEntities?: Array<{ entityId: string; label: string; href: string }>
): Promise<AdminNavItem[]> {
  function capitalize(s: string) {
    return s.charAt(0).toUpperCase() + s.slice(1)
  }
  function deriveTitleFromPath(p: string) {
    const seg = p.split('/').filter(Boolean).pop() || ''
    return seg ? seg.split('-').map(capitalize).join(' ') : 'Home'
  }
  const entries: AdminNavItem[] = []

  // Helper: server/client capable feature-check
  async function canUserAccessFeatures(required: string[]): Promise<boolean> {
    if (!required || required.length === 0) return true
    // Default values for client-side
    let url = '/api/auth/feature-check'
    let headersInit: Record<string, string> | undefined
    if (typeof window === 'undefined') {
      // On the server, build absolute URL and forward cookies so auth is available
      try {
        const { headers: getHeaders } = await import('next/headers')
        const h = await getHeaders()
        const host = h.get('x-forwarded-host') || h.get('host') || ''
        const proto = h.get('x-forwarded-proto') || 'http'
        const cookie = h.get('cookie') || ''
        if (host) url = `${proto}://${host}/api/auth/feature-check`
        headersInit = { cookie }
      } catch {
        // ignore; fall back to relative URL without forwarded cookies
      }
    }
    try {
      const res = await fetch(url, {
        method: 'POST',
        credentials: 'include' as any,
        headers: { 'content-type': 'application/json', ...(headersInit || {}) },
        body: JSON.stringify({ features: required }),
      } as any)
      if (!res.ok) return false
      const data = await res.json().catch(() => ({ ok: false }))
      return !!data?.ok
    } catch {
      return false
    }
  }

  // Icons are defined per-page in metadata; no heuristic derivation here.
  for (const m of modules) {
    const groupDefault = capitalize(m.id)
    for (const r of m.backendRoutes ?? []) {
      const href = (r.pattern ?? r.path ?? '') as string
      if (!href || href.includes('[')) continue
      if ((r as any).navHidden) continue
      const title = (r.title as string) || deriveTitleFromPath(href)
      const group = (r.group as string) || groupDefault
      const visible = r.visible ? await Promise.resolve(r.visible(ctx)) : true
      if (!visible) continue
      const enabled = r.enabled ? await Promise.resolve(r.enabled(ctx)) : true
      // If roles are required, check; otherwise include
      const required = (r.requireRoles as string[]) || []
      if (required.length) {
        const roles = ctx.auth?.roles || []
        const ok = required.some((role) => roles.includes(role))
        if (!ok) continue
      }
      // If features are required, verify with server via helper (SSR/CSR-aware)
      const features = (r as any).requireFeatures as string[] | undefined
      if (features && features.length) {
        const ok = await canUserAccessFeatures(features)
        if (!ok) continue
      }
      const order = (r as any).order as number | undefined
      const priority = ((r as any).priority as number | undefined) ?? order
      let icon = (r as any).icon as ReactNode | undefined
      entries.push({ group, title, href, enabled, order, priority, icon })
    }
  }
  // Build hierarchy: treat routes whose href starts with a parent href + '/'
  const byHref = new Map<string, AdminNavItem>()
  for (const e of entries) byHref.set(e.href, e)
  const roots: AdminNavItem[] = []
  for (const e of entries) {
    // Find the longest parent href that is a strict prefix and within same group
    let parent: AdminNavItem | undefined
    for (const p of entries) {
      if (p === e) continue
      if (p.group !== e.group) continue
      if (!e.href.startsWith(p.href + '/')) continue
      if (!parent || p.href.length > parent.href.length) parent = p
    }
    if (parent) {
      parent.children = parent.children || []
      parent.children.push(e)
    } else {
      roots.push(e)
    }
  }

  // Add dynamic user entities to the navigation
  if (userEntities && userEntities.length > 0) {
    const tableIcon = React.createElement(
      'svg',
      { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
      React.createElement('rect', { x: 3, y: 4, width: 18, height: 16, rx: 2 }),
      React.createElement('path', { d: 'M3 10h18M9 4v16M15 4v16' }),
    )
    // Find the "User Entities" item in the Data designer group (it should be a root item)
    const userEntitiesItem = roots.find(item => item.group === 'Data designer' && item.title === 'User Entities')
    if (userEntitiesItem) {
      const existingChildren = userEntitiesItem.children || []
      const dynamicUserEntities = userEntities.map((entity) => ({
        group: 'Data designer',
        title: entity.label,
        href: entity.href,
        enabled: true,
        order: 1000, // High order to appear at the end
        icon: tableIcon,
      }))
      // Merge and deduplicate by href to avoid duplicates coming from server or generator
      const merged = [...existingChildren, ...dynamicUserEntities]
      const byHref = new Map<string, AdminNavItem>()
      for (const it of merged) {
        if (!byHref.has(it.href)) byHref.set(it.href, it)
      }
      userEntitiesItem.children = Array.from(byHref.values())
    }
  }

  // Sorting: group, then priority/order, then title. Apply within children too.
  const sortItems = (arr: AdminNavItem[]) => {
    arr.sort((a, b) => {
      if (a.group !== b.group) return a.group.localeCompare(b.group)
      const ap = a.priority ?? a.order ?? 10_000
      const bp = b.priority ?? b.order ?? 10_000
      if (ap !== bp) return ap - bp
      return a.title.localeCompare(b.title)
    })
    for (const it of arr) if (it.children?.length) sortItems(it.children)
  }
  sortItems(roots)
  return roots
}
