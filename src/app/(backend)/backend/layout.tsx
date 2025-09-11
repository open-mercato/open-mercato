import Link from 'next/link'
import { modules } from '@/modules/registry'
import { getAuthFromCookies } from '@/lib/auth/server'

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function deriveTitleFromPath(p: string) {
  const seg = p.split('/').filter(Boolean).pop() || ''
  return seg ? seg.split('-').map(capitalize).join(' ') : 'Home'
}

export default async function BackendLayout({ children }: { children: React.ReactNode }) {
  const auth = await getAuthFromCookies()
  const items: { group: string; title: string; href: string }[] = []
  for (const m of modules) {
    const groupDefault = capitalize(m.id)
    for (const r of m.backendRoutes ?? []) {
      const href = (r.pattern ?? r.path ?? '')
      if (!href || href.includes('[')) continue // skip dynamic in menu
      const title = r.title || deriveTitleFromPath(href)
      const group = r.group || groupDefault
      items.push({ group, title, href })
    }
  }
  items.sort((a, b) => (a.group === b.group ? a.title.localeCompare(b.title) : a.group.localeCompare(b.group)))
  const groups = Array.from(new Set(items.map(i => i.group)))

  return (
    <div className="min-h-svh grid grid-cols-[240px_1fr]">
      <aside className="border-r bg-background/60 p-4">
        <div className="text-sm font-semibold mb-4">Admin</div>
        <nav className="flex flex-col gap-3">
          {groups.map(g => (
            <div key={g}>
              <div className="text-xs uppercase text-muted-foreground mb-2">{g}</div>
              <div className="flex flex-col gap-1">
                {items.filter(i => i.group === g).map(i => (
                  <Link key={i.href} href={i.href} className="text-sm hover:underline">
                    {i.title}
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </nav>
      </aside>
      <div className="flex min-h-svh flex-col">
        <header className="border-b bg-background/60 px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="size-6 rounded bg-foreground" />
            <div className="font-semibold">EHR Admin</div>
          </div>
          <UserMenu email={auth?.email} />
        </header>
        <main className="p-6">{children}</main>
      </div>
    </div>
  )
}

function UserMenu({ email }: { email?: string }) {
  // small client shim via "use client" forwarder
  // implemented inline to keep file count small
  return <UserMenuClient email={email} />
}

// Client part
// eslint-disable-next-line @next/next/no-sync-scripts
export const dynamic = 'force-dynamic'

// co-located client component
// @ts-ignore
function UserMenuClient({ email }) {
  // inline client using a simple dropdown with details/summary
  return (
    <details className="relative">
      <summary className="list-none cursor-pointer text-sm">{email || 'User'}</summary>
      <div className="absolute right-0 mt-2 w-40 rounded-md border bg-background p-1 shadow">
        <form action="/api/auth/logout" method="POST">
          <button className="w-full text-left text-sm px-2 py-1 rounded hover:bg-accent">Logout</button>
        </form>
      </div>
    </details>
  )
}

