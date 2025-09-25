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
  const groupNames = Array.from(new Set(entries.map((i) => i.group)))
  const groups = groupNames.map((name) => ({
    name,
    items: entries
      .filter((i) => i.group === name)
      .map((i) => ({ href: i.href, title: i.title, enabled: i.enabled, icon: i.icon })),
  }))

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
