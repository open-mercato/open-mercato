import { NextResponse } from 'next/server'
import { modules } from '@/generated/modules.generated'
import { getAuthFromRequest } from '@/lib/auth/server'
import { createRequestContainer } from '@/lib/di/container'
import { CustomEntity } from '@open-mercato/core/modules/entities/data/entities'

export const metadata = {
  GET: { requireAuth: true },
}

export async function GET(req: Request) {
  const auth = getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { resolve } = await createRequestContainer()
  const em = resolve('em') as any
  const rbac = resolve('rbacService') as any
  const cache = resolve('cache') as any

  // Cache key is user + tenant + organization scoped
  const cacheKey = `nav:sidebar:${auth.sub}:${auth.tenantId || 'null'}:${auth.orgId || 'null'}`
  // try {
  //   if (cache) {
  //     const cached = await cache.get(cacheKey)
  //     if (cached) return NextResponse.json(cached)
  //   }
  // } catch {}

  // Load ACL once; we'll evaluate features locally without multiple calls
  const acl = await rbac.loadAcl(auth.sub, { tenantId: auth.tenantId ?? null, organizationId: auth.orgId ?? null })

  function matchFeature(required: string, granted: string): boolean {
    if (granted === '*') return true
    if (granted.endsWith('.*')) {
      const prefix = granted.slice(0, -2)
      return required === prefix || required.startsWith(prefix + '.')
    }
    return granted === required
  }
  function haveAllFeatures(required?: string[]): boolean {
    if (!required || required.length === 0) return true
    if (acl.isSuperAdmin) return true
    return required.every((reqF) => (acl.features || []).some((g: string) => matchFeature(reqF, g)))
  }

  // Build nav entries from discovered backend routes
  type Entry = { group: string; title: string; href: string; enabled: boolean; order?: number; priority?: number }
  const entries: Entry[] = []

  function capitalize(s: string) { return s.charAt(0).toUpperCase() + s.slice(1) }
  function deriveTitleFromPath(p: string) {
    const seg = p.split('/').filter(Boolean).pop() || ''
    return seg ? seg.split('-').map(capitalize).join(' ') : 'Home'
  }

  const ctx = { auth: { roles: auth.roles || [], sub: auth.sub, tenantId: auth.tenantId, orgId: auth.orgId } }
  for (const m of (modules as any[])) {
    const groupDefault = capitalize(m.id)
    for (const r of (m.backendRoutes || [])) {
      const href = (r.pattern ?? r.path ?? '') as string
      if (!href || href.includes('[')) continue
      if ((r as any).navHidden) continue
      const title = (r.title as string) || deriveTitleFromPath(href)
      const group = (r.group as string) || groupDefault
      const visible = r.visible ? await Promise.resolve(r.visible(ctx)) : true
      if (!visible) continue
      const enabled = r.enabled ? await Promise.resolve(r.enabled(ctx)) : true
      const requiredRoles = (r.requireRoles as string[]) || []
      if (requiredRoles.length) {
        const roles = auth.roles || []
        const ok = requiredRoles.some((role) => roles.includes(role))
        if (!ok) continue
      }
      const features = (r as any).requireFeatures as string[] | undefined
      if (!haveAllFeatures(features)) continue
      const order = (r as any).order as number | undefined
      const priority = ((r as any).priority as number | undefined) ?? order
      entries.push({ group, title, href, enabled, order, priority })
    }
  }

  // Parent-child relationships within the same group by href prefix
  const roots: any[] = []
  for (const e of entries) {
    let parent: any | undefined
    for (const p of entries) {
      if (p === e) continue
      if (p.group !== e.group) continue
      if (!e.href.startsWith(p.href + '/')) continue
      if (!parent || p.href.length > parent.href.length) parent = p
    }
    if (parent) {
      ;(parent as any).children = (parent as any).children || []
      ;(parent as any).children.push(e)
    } else {
      roots.push(e)
    }
  }

  // Add dynamic user entities into Data designer > User Entities
  const where: any = { isActive: true, showInSidebar: true }
  where.$and = [
    { $or: [ { organizationId: auth.orgId ?? undefined as any }, { organizationId: null } ] },
    { $or: [ { tenantId: auth.tenantId ?? undefined as any }, { tenantId: null } ] },
  ]
  try {
    const entities = await em.find(CustomEntity as any, where as any, { orderBy: { label: 'asc' } as any })
    const items = (entities as any[]).map((e) => ({
      entityId: e.entityId,
      label: e.label,
      href: `/backend/entities/user/${encodeURIComponent(e.entityId)}/records`
    }))
    if (items.length) {
      const dd = roots.find((it: any) => it.group === 'Data designer' && it.title === 'User Entities')
      if (dd) {
        const existing = dd.children || []
        const dynamic = items.map((it) => ({ group: 'Data designer', title: it.label, href: it.href, enabled: true, order: 1000 }))
        const byHref = new Map<string, any>()
        for (const c of existing) if (!byHref.has(c.href)) byHref.set(c.href, c)
        for (const c of dynamic) if (!byHref.has(c.href)) byHref.set(c.href, c)
        dd.children = Array.from(byHref.values())
      }
    }
  } catch (e) {
    console.error('Error loading user entities', e)
  }

  // Sort roots and children
  const sortItems = (arr: any[]) => {
    arr.sort((a, b) => {
      if (a.group !== b.group) return a.group.localeCompare(b.group)
      const ap = a.priority ?? a.order ?? 10000
      const bp = b.priority ?? b.order ?? 10000
      if (ap !== bp) return ap - bp
      return String(a.title).localeCompare(String(b.title))
    })
    for (const it of arr) if (it.children?.length) sortItems(it.children)
  }
  sortItems(roots)

  // Group into sidebar groups
  const groupMap = new Map<string, { name: string; items: any[]; weight: number }>()
  for (const e of roots) {
    const w = (e.priority ?? e.order ?? 10000)
    if (!groupMap.has(e.group)) groupMap.set(e.group, { name: e.group, items: [], weight: w })
    else { const g = groupMap.get(e.group)!; if (w < g.weight) g.weight = w }
    const g = groupMap.get(e.group)!
    g.items.push({ href: e.href, title: e.title, enabled: e.enabled, children: (e.children || []).map((c: any) => ({ href: c.href, title: c.title, enabled: c.enabled })) })
  }
  const groups = Array.from(groupMap.values()).sort((a, b) => a.weight - b.weight)

  const payload = { groups }

  try {
    if (cache) {
      const tags = [ `rbac:user:${auth.sub}`, auth.tenantId ? `rbac:tenant:${auth.tenantId}` : undefined, `nav:entities:${auth.tenantId || 'null'}` ].filter(Boolean) as string[]
      await cache.set(cacheKey, payload, { tags })
    }
  } catch {}

  return NextResponse.json(payload)
}


