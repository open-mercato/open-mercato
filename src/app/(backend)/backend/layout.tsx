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

  const ctxAuth = auth ? { 
    roles: auth.roles || [], 
    sub: auth.sub, 
    tenantId: auth.tenantId, 
    orgId: auth.orgId 
  } : undefined
  const ctx = { auth: ctxAuth, path }
  
  // Prefer server-provided nav via API to centralize fetching and caching
  let groups: { name: string; items: { href: string; title: string; enabled?: boolean; icon?: React.ReactNode; children?: { href: string; title: string; enabled?: boolean; icon?: React.ReactNode }[] }[] }[] = []
  try {
    const { headers: getHeaders } = await import('next/headers')
    const h = await getHeaders()
    const host = h.get('x-forwarded-host') || h.get('host') || ''
    const proto = h.get('x-forwarded-proto') || 'http'
    const cookie = h.get('cookie') || ''
    const url = host ? `${proto}://${host}/api/auth/admin/nav` : '/api/auth/admin/nav'
    const res = await fetch(url, { headers: { cookie } as any, cache: 'no-store' as any } as any)
    if (res.ok) {
      const data = await res.json()
      groups = Array.isArray(data?.groups) ? data.groups : []
    }
  } catch {}

  // Derive current title from path and fetched groups
  const allEntries: Array<{ href: string; title: string; group: string; children?: any[] }> = groups.flatMap((g) => g.items.map((i: any) => ({ ...i, group: g.name })))
  const current = allEntries.find((i) => path.startsWith(i.href))
  const currentTitle = current?.title || ''
  const match = findBackendMatch(modules as any[], path)
  const breadcrumb = (match?.route as any)?.breadcrumb as Array<{ label: string; href?: string }> | undefined
  // Read collapsed state from cookie for SSR-perfect initial render
  let initialCollapsed = false
  try {
    const { cookies } = await import('next/headers')
    const c = await cookies()
    const v = c.get('om_sidebar_collapsed')?.value
    initialCollapsed = v === '1'
  } catch {}

  return (
    <AppShell key={path} productName="Open Mercato" email={auth?.email} groups={groups} currentTitle={currentTitle} breadcrumb={breadcrumb} sidebarCollapsedDefault={initialCollapsed} rightHeaderSlot={<UserMenu email={auth?.email} />} userEntitiesApi="/api/entities/sidebar-entities" adminNavApi="/api/auth/admin/nav"> 
      {children}
    </AppShell>
  )
}
export const dynamic = 'force-dynamic'
