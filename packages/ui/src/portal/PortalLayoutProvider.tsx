"use client"
import { type ReactNode, useMemo } from 'react'
import { usePathname } from 'next/navigation'
import { PortalProvider, usePortalContext } from './PortalContext'
import PortalShell from './PortalShell'

type PortalLayoutProviderProps = {
  children: ReactNode
}

/**
 * Renders the portal shell (sidebar, header, footer) in the layout
 * so it persists across page navigations. Only the content area swaps.
 *
 * For non-portal routes, children pass through unwrapped.
 */
export function PortalLayoutProvider({ children }: PortalLayoutProviderProps) {
  const pathname = usePathname()

  const orgSlug = useMemo(() => {
    const match = pathname.match(/^\/([^/]+)\/portal(?:\/|$)/)
    return match ? match[1] : null
  }, [pathname])

  if (!orgSlug) {
    return <>{children}</>
  }

  return (
    <PortalProvider orgSlug={orgSlug}>
      <PortalShellWrapper>{children}</PortalShellWrapper>
    </PortalProvider>
  )
}

/**
 * Inner wrapper that reads auth from context and renders PortalShell.
 * This component persists in the layout — only {children} (the page content) changes.
 */
function PortalShellWrapper({ children }: { children: ReactNode }) {
  const { auth, tenant } = usePortalContext()

  const authenticated = !auth.loading && !!auth.user

  return (
    <PortalShell
      authenticated={authenticated}
      enableEventBridge={authenticated}
    >
      {children}
    </PortalShell>
  )
}
