import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { modules } from '@/generated/modules.generated'
import { getAuthFromRequest } from '@/lib/auth/server'
import { createRequestContainer } from '@/lib/di/container'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { hasAllFeatures } from '@open-mercato/shared/security/features'
import { CustomEntity } from '@open-mercato/core/modules/entities/data/entities'
import { slugifySidebarId } from '@open-mercato/shared/modules/navigation/sidebarPreferences'
import { applySidebarPreference, loadFirstRoleSidebarPreference, loadSidebarPreference } from '../../services/sidebarPreferencesService'
import { Role } from '../../data/entities'

export const metadata = {
  GET: { requireAuth: true },
}

const sidebarNavItemSchema: z.ZodType<{ href: string; title: string; defaultTitle: string; enabled: boolean; hidden?: boolean; children?: any[] }> = z.lazy(() =>
  z.object({
    href: z.string(),
    title: z.string(),
    defaultTitle: z.string(),
    enabled: z.boolean(),
    hidden: z.boolean().optional(),
    children: z.array(sidebarNavItemSchema).optional(),
  })
)

const adminNavResponseSchema = z.object({
  groups: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      defaultName: z.string(),
      items: z.array(sidebarNavItemSchema),
    })
  ),
})

const adminNavErrorSchema = z.object({
  error: z.string(),
})

type SidebarItemNode = {
  href: string
  title: string
  defaultTitle: string
  enabled: boolean
  hidden?: boolean
  children?: SidebarItemNode[]
}

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { translate, locale } = await resolveTranslations()

  const { resolve } = await createRequestContainer()
  const em = resolve('em') as any
  const rbac = resolve('rbacService') as any
  const cache = resolve('cache') as any

  // Cache key is user + tenant + organization scoped
  const cacheKey = `nav:sidebar:${locale}:${auth.sub}:${auth.tenantId || 'null'}:${auth.orgId || 'null'}`
  // try {
  //   if (cache) {
  //     const cached = await cache.get(cacheKey)
  //     if (cached) return NextResponse.json(cached)
  //   }
  // } catch {}

  // Load ACL once; we'll evaluate features locally without multiple calls
  const acl = await rbac.loadAcl(auth.sub, { tenantId: auth.tenantId ?? null, organizationId: auth.orgId ?? null })

  // Build nav entries from discovered backend routes
  type Entry = {
    groupId: string
    groupName: string
    groupKey?: string
    title: string
    titleKey?: string
    href: string
    enabled: boolean
    order?: number
    priority?: number
    children?: Entry[]
  }
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
      const titleKey = (r as any).pageTitleKey ?? (r as any).titleKey
      const groupName = (r.group as string) || groupDefault
      const groupKey = (r as any).pageGroupKey ?? (r as any).groupKey
      const groupId = typeof groupKey === 'string' && groupKey ? groupKey : slugifySidebarId(groupName)
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
      if (!acl.isSuperAdmin && !hasAllFeatures(acl.features, features)) continue
      const order = (r as any).order as number | undefined
      const priority = ((r as any).priority as number | undefined) ?? order
      entries.push({ groupId, groupName, groupKey, title, titleKey, href, enabled, order, priority })
    }
  }

  // Parent-child relationships within the same group by href prefix
  const roots: any[] = []
  for (const e of entries) {
    let parent: any | undefined
    for (const p of entries) {
      if (p === e) continue
      if (p.groupId !== e.groupId) continue
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
      const dd = roots.find((it: Entry) => it.groupKey === 'entities.nav.group' && it.titleKey === 'entities.nav.userEntities')
      if (dd) {
        const existing = dd.children || []
        const dynamic = items.map((it) => ({
          groupId: dd.groupId,
          groupName: dd.groupName,
          groupKey: dd.groupKey,
          title: it.label,
          href: it.href,
          enabled: true,
          order: 1000,
          priority: 1000,
        }))
        const byHref = new Map<string, Entry>()
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
  type GroupBucket = {
    id: string
    rawName: string
    key?: string
    weight: number
    entries: Entry[]
  }

  const groupBuckets = new Map<string, GroupBucket>()
  for (const entry of roots) {
    const weight = entry.priority ?? entry.order ?? 10_000
    if (!groupBuckets.has(entry.groupId)) {
      groupBuckets.set(entry.groupId, {
        id: entry.groupId,
        rawName: entry.groupName,
        key: entry.groupKey as string | undefined,
        weight,
        entries: [entry],
      })
    } else {
      const bucket = groupBuckets.get(entry.groupId)!
      bucket.entries.push(entry)
      if (weight < bucket.weight) bucket.weight = weight
      if (!bucket.key && entry.groupKey) bucket.key = entry.groupKey as string
      if (!bucket.rawName && entry.groupName) bucket.rawName = entry.groupName
    }
  }

  const toItem = (entry: Entry): SidebarItemNode => {
    const defaultTitle = entry.titleKey ? translate(entry.titleKey, entry.title) : entry.title
    return {
      href: entry.href,
      title: defaultTitle,
      defaultTitle,
      enabled: entry.enabled,
      children: entry.children?.map((child) => toItem(child)),
    }
  }

  const groups = Array.from(groupBuckets.values()).map((bucket) => {
    const defaultName = bucket.key ? translate(bucket.key, bucket.rawName) : bucket.rawName
    return {
      id: bucket.id,
      key: bucket.key,
      name: defaultName,
      defaultName,
      weight: bucket.weight,
      items: bucket.entries.map((entry) => toItem(entry)),
    }
  })

  let rolePreference = null
  if (Array.isArray(auth.roles) && auth.roles.length) {
    const roleScope = auth.tenantId
      ? { $or: [{ tenantId: auth.tenantId }, { tenantId: null }] }
      : { tenantId: null }
    const roleRecords = await em.find(Role, {
      name: { $in: auth.roles },
      ...roleScope,
    } as any)
    const roleIds = roleRecords.map((role: Role) => role.id)
    if (roleIds.length) {
      rolePreference = await loadFirstRoleSidebarPreference(em, {
        roleIds,
        tenantId: auth.tenantId ?? null,
        locale,
      })
    }
  }

  const groupsWithRole = rolePreference ? applySidebarPreference(groups, rolePreference) : groups
  const baseForUser = adoptSidebarDefaults(groupsWithRole)

  const preference = await loadSidebarPreference(em, {
    userId: auth.sub,
    tenantId: auth.tenantId ?? null,
    organizationId: auth.orgId ?? null,
    locale,
  })

  const withPreference = applySidebarPreference(baseForUser, preference)

  const payload = {
    groups: withPreference.map((group) => ({
      id: group.id,
      name: group.name,
      defaultName: group.defaultName,
      items: (group.items as SidebarItemNode[]).map((item) => ({
        href: item.href,
        title: item.title,
        defaultTitle: item.defaultTitle,
        enabled: item.enabled,
        hidden: item.hidden,
        children: item.children?.map((child) => ({
          href: child.href,
          title: child.title,
          defaultTitle: child.defaultTitle,
          enabled: child.enabled,
          hidden: child.hidden,
        })),
      })),
    })),
  }

  try {
    if (cache) {
      const tags = [
        `rbac:user:${auth.sub}`,
        auth.tenantId ? `rbac:tenant:${auth.tenantId}` : undefined,
        `nav:entities:${auth.tenantId || 'null'}`,
        `nav:locale:${locale}`,
        `nav:sidebar:user:${auth.sub}`,
        `nav:sidebar:scope:${auth.sub}:${auth.tenantId || 'null'}:${auth.orgId || 'null'}:${locale}`,
        ...(Array.isArray(auth.roles) ? auth.roles.map((role: string) => `nav:sidebar:role:${role}`) : []),
      ].filter(Boolean) as string[]
      await cache.set(cacheKey, payload, { tags })
    }
  } catch {}

  return NextResponse.json(payload)
}

function adoptSidebarDefaults(groups: ReturnType<typeof applySidebarPreference>) {
  const adoptItems = <T extends { title: string; defaultTitle?: string; children?: T[] }>(items: T[]): T[] =>
    items.map((item) => ({
      ...item,
      defaultTitle: item.title,
      children: item.children ? adoptItems(item.children) : undefined,
    }))

  return groups.map((group) => ({
    ...group,
    defaultName: group.name,
    items: adoptItems(group.items),
  }))
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Authentication & Accounts',
  summary: 'Admin sidebar navigation',
  methods: {
    GET: {
      summary: 'Resolve sidebar entries',
      description:
        'Returns the backend navigation tree available to the authenticated administrator after applying role and personal sidebar preferences.',
      responses: [
        { status: 200, description: 'Sidebar navigation structure', schema: adminNavResponseSchema },
        { status: 401, description: 'Unauthorized', schema: adminNavErrorSchema },
      ],
    },
  },
}
