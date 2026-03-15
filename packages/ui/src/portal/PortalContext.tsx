"use client"
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'
import type { CustomerUser, CustomerRole, CustomerAuthResult } from '@open-mercato/shared/modules/customer-auth'

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type TenantState = {
  tenantId: string | undefined
  organizationId: string | undefined
  organizationName: string | undefined
  loading: boolean
  error: string | null
}

type PortalContextValue = {
  auth: CustomerAuthResult & { logout: () => Promise<void> }
  tenant: TenantState
  orgSlug: string
}

const PortalCtx = createContext<PortalContextValue | null>(null)

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

/**
 * Read portal auth/tenant state from the persistent context.
 * Must be called inside a `<PortalProvider>`.
 */
export function usePortalContext(): PortalContextValue {
  const ctx = useContext(PortalCtx)
  if (!ctx) throw new Error('usePortalContext must be used inside <PortalProvider>')
  return ctx
}

/* ------------------------------------------------------------------ */
/*  Provider                                                           */
/* ------------------------------------------------------------------ */

type PortalProviderProps = {
  orgSlug: string
  children: ReactNode
}

/**
 * Provides cached auth + tenant state for all portal pages.
 * Mount once in a layout — child page navigations reuse the cached data
 * without re-fetching.
 */
export function PortalProvider({ orgSlug, children }: PortalProviderProps) {
  /* ---- Auth state (fetched once) ---- */
  const [authState, setAuthState] = useState<CustomerAuthResult>({
    user: null,
    roles: [],
    resolvedFeatures: [],
    isPortalAdmin: false,
    loading: true,
    error: null,
  })

  useEffect(() => {
    let cancelled = false

    async function fetchProfile() {
      try {
        const res = await fetch('/api/customer_accounts/portal/profile', { credentials: 'include' })
        if (cancelled) return

        if (res.status === 401) {
          setAuthState((prev) => ({ ...prev, loading: false, user: null }))
          return
        }
        if (!res.ok) {
          setAuthState((prev) => ({ ...prev, loading: false, error: `HTTP ${res.status}` }))
          return
        }

        const data = await res.json()
        if (!data.ok) {
          setAuthState((prev) => ({ ...prev, loading: false, error: data.error || 'Unknown error' }))
          return
        }

        setAuthState({
          user: data.user,
          roles: data.roles || [],
          resolvedFeatures: data.resolvedFeatures || [],
          isPortalAdmin: data.isPortalAdmin || false,
          loading: false,
          error: null,
        })
      } catch {
        if (!cancelled) {
          setAuthState((prev) => ({ ...prev, loading: false, error: 'Network error' }))
        }
      }
    }

    fetchProfile()
    return () => { cancelled = true }
  }, [])

  const logout = useCallback(async () => {
    try {
      await fetch('/api/customer_accounts/portal/logout', {
        method: 'POST',
        credentials: 'include',
      })
    } catch {
      // Best effort
    }
    setAuthState({
      user: null,
      roles: [],
      resolvedFeatures: [],
      isPortalAdmin: false,
      loading: false,
      error: null,
    })
    window.location.assign(`/${orgSlug}/portal/login`)
  }, [orgSlug])

  /* ---- Tenant state (fetched once) ---- */
  const [tenantState, setTenantState] = useState<TenantState>({
    tenantId: undefined,
    organizationId: undefined,
    organizationName: undefined,
    loading: true,
    error: null,
  })

  useEffect(() => {
    let cancelled = false

    async function lookup() {
      if (!orgSlug) {
        setTenantState((prev) => ({ ...prev, loading: false, error: 'No organization slug provided.' }))
        return
      }

      try {
        const res = await fetch(`/api/directory/organizations/lookup?slug=${encodeURIComponent(orgSlug)}`)
        if (cancelled) return

        if (!res.ok) {
          const data = await res.json().catch(() => null)
          setTenantState((prev) => ({
            ...prev,
            loading: false,
            error: data?.error || 'Organization not found.',
          }))
          return
        }

        const data = await res.json()
        if (!data.ok || !data.organization) {
          setTenantState((prev) => ({ ...prev, loading: false, error: 'Organization not found.' }))
          return
        }

        setTenantState({
          tenantId: data.organization.tenantId ?? undefined,
          organizationId: data.organization.id,
          organizationName: data.organization.name,
          loading: false,
          error: null,
        })
      } catch {
        if (!cancelled) {
          setTenantState((prev) => ({ ...prev, loading: false, error: 'Failed to load organization.' }))
        }
      }
    }

    lookup()
    return () => { cancelled = true }
  }, [orgSlug])

  /* ---- Context value (stable reference) ---- */
  const authRef = useRef(authState)
  authRef.current = authState

  const value: PortalContextValue = {
    auth: { ...authState, logout },
    tenant: tenantState,
    orgSlug,
  }

  return <PortalCtx.Provider value={value}>{children}</PortalCtx.Provider>
}
