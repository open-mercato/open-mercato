export type AdminNavItem = {
  group: string
  title: string
  href: string
  enabled: boolean
  order?: number
  icon?: string
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
      const icon = (r as any).icon as string | undefined
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
