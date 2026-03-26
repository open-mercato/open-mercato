"use client"
import type { ReactNode } from 'react'
import type { CustomerAuthContext } from '@open-mercato/shared/modules/customer-auth'
import { PortalProvider } from './PortalContext'
import PortalShell from './PortalShell'

type PortalLayoutShellProps = {
  children: ReactNode
  orgSlug: string
  organizationName: string | null
  tenantId: string | null
  organizationId: string | null
  authenticated: boolean
  userName: string | null
  userEmail: string | null
  customerAuth: CustomerAuthContext | null
}

/**
 * Portal layout shell initialized with server-resolved data.
 *
 * Receives auth + org data as props from the server layout component.
 * No client-side fetching for auth or tenant — identical pattern to
 * the backend AppShell which receives server-resolved data.
 *
 * This eliminates all loading states and layout flashes:
 * - Auth is resolved from the customer JWT cookie on the server
 * - Org name is queried from DB on the server
 * - PortalShell receives stable props from frame 1
 */
export function PortalLayoutShell({
  children,
  orgSlug,
  organizationName,
  tenantId,
  organizationId,
  authenticated,
  userName,
  userEmail,
  customerAuth,
}: PortalLayoutShellProps) {
  return (
    <PortalProvider
      orgSlug={orgSlug}
      initialAuth={customerAuth}
      initialTenant={{
        tenantId: tenantId ?? undefined,
        organizationId: organizationId ?? undefined,
        organizationName: organizationName ?? undefined,
      }}
    >
      <PortalShell
        authenticated={authenticated}
        enableEventBridge={authenticated}
        orgSlug={orgSlug}
        organizationName={organizationName ?? undefined}
        userName={userName ?? undefined}
        userEmail={userEmail ?? undefined}
      >
        {children}
      </PortalShell>
    </PortalProvider>
  )
}
