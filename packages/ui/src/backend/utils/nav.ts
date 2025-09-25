export type AdminNavItem = {
  group: string
  title: string
  href: string
  enabled: boolean
  order?: number
  icon: string
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

  function deriveIcon(key: string): string | undefined {
    const k = key.toLowerCase()
    if (/(home|dashboard|start)/.test(k)) return 'home'
    if (/(order|checkout)/.test(k)) return 'cart'
    if (/(product|catalog|variant|option)/.test(k)) return 'box'
    if (/(inventory|stock)/.test(k)) return 'inventory'
    if (/(customer|user|account)/.test(k)) return 'user'
    if (/(promotion|discount|coupon)/.test(k)) return 'tag'
    if (/(report|analytics|insight)/.test(k)) return 'chart'
    if (/(setting|config|preference)/.test(k)) return 'settings'
    if (/(collection|category)/.test(k)) return 'collection'
    if (/(channel|saleschannel)/.test(k)) return 'channel'
    if (/(shipping|delivery)/.test(k)) return 'truck'
    if (/(tax|billing|invoice|payment)/.test(k)) return 'billing'
    return undefined
  }
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
      let icon = (r as any).icon as string | undefined
      if (!icon) icon = deriveIcon(`${group} ${title} ${href}`)
      if (!icon) icon = 'list'
      entries.push({ group, title, href, enabled, order, icon })
    }
  }
  entries.sort((a, b) => {
    if (a.group !== b.group) return a.group.localeCompare(b.group)
    const ao = a.order ?? 10_000
    const bo = b.order ?? 10_000
    if (ao !== bo) return ao - bo
    return a.title.localeCompare(b.title)
  })
  return entries
}
