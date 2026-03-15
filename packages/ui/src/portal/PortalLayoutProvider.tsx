"use client"
import { type ReactNode, useMemo } from 'react'
import { usePathname } from 'next/navigation'
import { PortalProvider } from './PortalContext'
import PortalShell from './PortalShell'

type PortalLayoutProviderProps = {
  children: ReactNode
}

/**
 * Known public portal routes that render without sidebar.
 * All other `/{orgSlug}/portal/*` routes get the authenticated sidebar layout.
 */
const PUBLIC_PORTAL_SUFFIXES = ['/portal/login', '/portal/signup']

function isPublicPortalRoute(pathname: string): boolean {
  // Exact match: /{orgSlug}/portal
  if (/^\/[^/]+\/portal\/?$/.test(pathname)) return true
  // Suffix match: /{orgSlug}/portal/login, /{orgSlug}/portal/signup
  return PUBLIC_PORTAL_SUFFIXES.some((suffix) => pathname.endsWith(suffix))
}

/**
 * Wraps portal routes in a persistent shell.
 *
 * Layout type (public vs authenticated) is determined from the URL path,
 * NOT from async auth state. This eliminates the layout flash where the
 * public layout briefly shows before switching to the authenticated sidebar.
 *
 * - Login, signup, landing → public layout (header only, no sidebar)
 * - Dashboard, profile, all other pages → authenticated layout (sidebar)
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

  const isPublic = isPublicPortalRoute(pathname)

  return (
    <PortalProvider orgSlug={orgSlug}>
      <PortalShell authenticated={!isPublic} enableEventBridge={!isPublic}>
        {children}
      </PortalShell>
    </PortalProvider>
  )
}
