"use client"
import * as React from 'react'

export function UserMenu({ email }: { email?: string }) {
  const [open, setOpen] = React.useState(false)
  const toggle = () => setOpen((v) => !v)
  return (
    <div className="relative">
      <button className="text-sm px-2 py-1 rounded hover:bg-accent" onClick={toggle} aria-expanded={open}>
        {email || 'User'}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-40 rounded-md border bg-background p-1 shadow">
          <form action="/api/auth/logout" method="POST">
            <button className="w-full text-left text-sm px-2 py-1 rounded hover:bg-accent" type="submit">Logout</button>
          </form>
        </div>
      )}
    </div>
  )
}

