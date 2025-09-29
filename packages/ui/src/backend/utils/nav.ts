import type { ReactNode } from 'react'

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
  ctx: { auth?: { roles?: string[] }; path?: string }
): Promise<AdminNavItem[]> {
  function capitalize(s: string) {
    return s.charAt(0).toUpperCase() + s.slice(1)
  }
  function deriveTitleFromPath(p: string) {
    const seg = p.split('/').filter(Boolean).pop() || ''
    return seg ? seg.split('-').map(capitalize).join(' ') : 'Home'
  }
  const entries: AdminNavItem[] = []

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
