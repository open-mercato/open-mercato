"use client"
import { type ReactNode, useMemo } from 'react'
import { usePathname } from 'next/navigation'
import { PortalProvider } from './PortalContext'

type PortalLayoutProviderProps = {
  children: ReactNode
}

/**
 * Conditionally wraps children in a PortalProvider when the current
 * route is a portal route (matches `/{orgSlug}/portal/...`).
 *
 * Mount this in the frontend catch-all layout. It extracts the orgSlug
 * from the pathname and provides persistent auth/tenant context for all
 * portal pages — eliminating re-fetches on navigation.
 *
 * Non-portal routes pass through unwrapped.
 */
export function PortalLayoutProvider({ children }: PortalLayoutProviderProps) {
  const pathname = usePathname()

  const orgSlug = useMemo(() => {
    // Match /{orgSlug}/portal or /{orgSlug}/portal/...
    const match = pathname.match(/^\/([^/]+)\/portal(?:\/|$)/)
    return match ? match[1] : null
  }, [pathname])

  if (!orgSlug) {
    // Not a portal route — render children directly
    return <>{children}</>
  }

  return (
    <PortalProvider orgSlug={orgSlug}>
      {children}
    </PortalProvider>
  )
}
