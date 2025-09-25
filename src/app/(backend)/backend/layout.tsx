import { modules } from '@/generated/modules.generated'
import { getAuthFromCookies } from '@/lib/auth/server'
import { headers } from 'next/headers'
import { AppShell } from '@open-mercato/ui/backend/AppShell'
import { buildAdminNav } from '@open-mercato/ui/backend/utils/nav'
import { UserMenu } from '@open-mercato/ui/backend/UserMenu'

export default async function BackendLayout({ children }: { children: React.ReactNode }) {
  const auth = await getAuthFromCookies()
  const h = await headers()
  const path = h.get('x-next-url') || ''
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

  return (
    <AppShell productName="Open Mercato" email={auth?.email} groups={groups} currentTitle={currentTitle} rightHeaderSlot={<UserMenu email={auth?.email} />}> 
      {children}
    </AppShell>
  )
}
