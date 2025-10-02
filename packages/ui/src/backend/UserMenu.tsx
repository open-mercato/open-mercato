"use client"
import * as React from 'react'
import { User, LogOut } from 'lucide-react'

export function UserMenu({ email }: { email?: string }) {
  const [open, setOpen] = React.useState(false)
  const buttonRef = React.useRef<HTMLButtonElement>(null)
  const menuRef = React.useRef<HTMLDivElement>(null)
  const logoutButtonRef = React.useRef<HTMLButtonElement>(null)

  // Toggle menu open/close
  const toggle = () => setOpen((v) => !v)

  // Open on hover, close when mouse leaves the menu area
  const onMouseEnter = () => setOpen(true)
  const onMouseLeave = () => setOpen(false)

  // Close menu when clicking outside
  React.useEffect(() => {
    if (!open) return
    function handleClick(event: MouseEvent) {
      if (
        menuRef.current &&
        !menuRef.current.contains(event.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  // Keyboard navigation
  React.useEffect(() => {
    if (!open) return
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false)
        buttonRef.current?.focus()
      } else if (event.key === 'ArrowDown' || event.key === 'Tab') {
        event.preventDefault()
        logoutButtonRef.current?.focus()
      } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        logoutButtonRef.current?.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open])

  // Focus the first menu item when menu opens
  React.useEffect(() => {
    if (open) {
      setTimeout(() => {
        logoutButtonRef.current?.focus()
      }, 0)
    }
  }, [open])

  return (
    <div className="relative" onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}>
      <button
        ref={buttonRef}
        className="text-sm px-2 py-1 rounded hover:bg-accent inline-flex items-center gap-2"
        onClick={() => setOpen(true)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls="user-menu-dropdown"
        id="user-menu-button"
        type="button"
        title={email || 'User'}
      >
        <User className="size-4" />
      </button>
      {open && (
        <div
          ref={menuRef}
          id="user-menu-dropdown"
          className="absolute right-0 top-full mt-0 w-40 rounded-md border bg-background p-1 shadow z-50"
          role="menu"
          aria-labelledby="user-menu-button"
          tabIndex={-1}
        >
          <form action="/api/auth/logout" method="POST">
            <button
              ref={logoutButtonRef}
              className="w-full text-left text-sm px-2 py-1 rounded hover:bg-accent inline-flex items-center gap-2 outline-none focus:outline-none focus-visible:outline-none ring-0 focus:ring-0 focus-visible:ring-0"
              type="submit"
              role="menuitem"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setOpen(false)
                  buttonRef.current?.focus()
                }
              }}
            >
              <LogOut className="size-4" />
              <span>Logout</span>
            </button>
          </form>
        </div>
      )}
    </div>
  )
}

