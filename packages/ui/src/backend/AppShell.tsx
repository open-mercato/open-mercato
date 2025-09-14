import * as React from 'react'
import Link from 'next/link'
import { Separator } from '../primitives/separator'

export type AppShellProps = {
  productName?: string
  email?: string
  groups: { name: string; items: { href: string; title: string; enabled?: boolean }[] }[]
  children: React.ReactNode
  rightHeaderSlot?: React.ReactNode
}

export function AppShell({ productName = 'Admin', email, groups, rightHeaderSlot, children }: AppShellProps) {
  return (
    <div className="min-h-svh grid grid-cols-[240px_1fr]">
      <aside className="border-r bg-background/60 p-4">
        <div className="text-sm font-semibold mb-4">{productName}</div>
        <nav className="flex flex-col gap-3">
          {groups.map((g) => (
            <div key={g.name}>
              <div className="text-xs uppercase text-muted-foreground mb-2">{g.name}</div>
              <div className="flex flex-col gap-1">
                {g.items.map((i) => (
                  <Link
                    key={i.href}
                    href={i.href}
                    className={`text-sm rounded px-2 py-1 hover:bg-accent hover:text-accent-foreground ${i.enabled === false ? 'pointer-events-none opacity-50' : ''}`}
                    aria-disabled={i.enabled === false}
                  >
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
            <div className="font-semibold">{productName}</div>
          </div>
          <div className="flex items-center gap-2 text-sm">
            {rightHeaderSlot ? (
              rightHeaderSlot
            ) : (
              <>
                <Separator orientation="vertical" className="w-px h-5 mx-1" />
                <span className="opacity-80">{email || 'User'}</span>
              </>
            )}
          </div>
        </header>
        <main className="p-6">{children}</main>
      </div>
    </div>
  )
}
