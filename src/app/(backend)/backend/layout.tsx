import { modules } from '@/generated/modules.generated'
import { findBackendMatch } from '@open-mercato/shared/modules/registry'
import { getAuthFromCookies } from '@/lib/auth/server'
import { AppShell } from '@open-mercato/ui/backend/AppShell'
import { buildAdminNav } from '@open-mercato/ui/backend/utils/nav'
import { UserMenu } from '@open-mercato/ui/backend/UserMenu'

export default async function BackendLayout({ children, params }: { children: React.ReactNode; params?: { slug?: string[] } }) {
  const auth = await getAuthFromCookies()

  // Prefer pathname injected by middleware; fallback to params-based path
  let path = ''
  try {
    const { headers } = await import('next/headers')
    const h = await headers()
    path = h.get('x-next-url') || ''
  } catch {}
  // Ensure we pass only a pathname
  if (path.includes('?')) path = path.split('?')[0]
  if (!path) {
    const slug = params?.slug ?? []
    path = '/backend' + (Array.isArray(slug) && slug.length ? '/' + slug.join('/') : '')
  }

  const ctx = { auth, path }
  const entries = await buildAdminNav(modules as any[], ctx)
  // Group entries and sort groups by the smallest priority/order among their roots
  const groupMap = new Map<string, {
    name: string,
    items: { href: string; title: string; enabled?: boolean; icon?: React.ReactNode; children?: { href: string; title: string; enabled?: boolean; icon?: React.ReactNode }[] }[],
    weight: number,
  }>()
  for (const e of entries) {
    const w = (e.priority ?? e.order ?? 10_000)
    if (!groupMap.has(e.group)) {
      groupMap.set(e.group, { name: e.group, items: [], weight: w })
    } else {
      const g = groupMap.get(e.group)!
      if (w < g.weight) g.weight = w
    }
    const g = groupMap.get(e.group)!
    g.items.push({
      href: e.href,
      title: e.title,
      enabled: e.enabled,
      icon: e.icon,
      children: (e.children || []).map((c) => ({ href: c.href, title: c.title, enabled: c.enabled, icon: c.icon })),
    })
  }
  const groups = Array.from(groupMap.values()).sort((a, b) => a.weight - b.weight)

  const current = entries.find((i) => path.startsWith(i.href))
  const currentTitle = current?.title || ''
  const match = findBackendMatch(modules as any[], path)
  const breadcrumb = (match?.route as any)?.breadcrumb as Array<{ label: string; href?: string }> | undefined
  // Read collapsed state from cookie for SSR-perfect initial render
  let initialCollapsed = false
  try {
    const { cookies } = await import('next/headers')
    const c = cookies()
    const v = c.get('om_sidebar_collapsed')?.value
    initialCollapsed = v === '1'
  } catch {}

  return (
    <AppShell key={path} productName="Open Mercato" email={auth?.email} groups={groups} currentTitle={currentTitle} breadcrumb={breadcrumb} sidebarCollapsedDefault={initialCollapsed} rightHeaderSlot={<UserMenu email={auth?.email} />}> 
      {children}
    </AppShell>
  )
}
export const dynamic = 'force-dynamic'
