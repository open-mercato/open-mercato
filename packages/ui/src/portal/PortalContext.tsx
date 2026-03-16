"use client"
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react'
import type { CustomerAuthResult } from '@open-mercato/shared/modules/customer-auth'
import type { CustomerAuthContext } from '@open-mercato/shared/modules/customer-auth'
import { apiCall } from '../backend/utils/apiCall'

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

export function usePortalContext(): PortalContextValue {
  const ctx = useContext(PortalCtx)
  if (!ctx) throw new Error('usePortalContext must be used inside <PortalProvider>')
  return ctx
}

/* ------------------------------------------------------------------ */
/*  Provider                                                           */
/* ------------------------------------------------------------------ */

type InitialTenant = {
  tenantId?: string
  organizationId?: string
  organizationName?: string
}

type PortalProviderProps = {
  orgSlug: string
  children: ReactNode
  /** Server-resolved customer auth. When provided, skips client-side fetching. */
  initialAuth?: CustomerAuthContext | null
  /** Server-resolved tenant data. When provided, skips client-side fetching. */
  initialTenant?: InitialTenant
}

/**
 * Provides auth + tenant state for portal pages.
 *
 * When `initialAuth` and `initialTenant` are provided (from server layout),
 * the context initializes with that data immediately — no loading state,
 * no client-side fetching, no blink.
 *
 * Falls back to client-side fetching only when initial data is not provided.
 */
export function PortalProvider({ orgSlug, children, initialAuth, initialTenant }: PortalProviderProps) {
  const hasServerData = initialAuth !== undefined

  /* ---- Auth state ---- */
  const [authState, setAuthState] = useState<CustomerAuthResult>(() => {
    if (hasServerData && initialAuth) {
      // Server-resolved auth — start fully loaded, no client-side fetch needed
      return {
        user: {
          id: initialAuth.sub,
          email: initialAuth.email,
          displayName: initialAuth.displayName,
          emailVerified: false,
          customerEntityId: initialAuth.customerEntityId ?? null,
          personEntityId: initialAuth.personEntityId ?? null,
          isActive: true,
          lastLoginAt: null,
          createdAt: '',
        },
        roles: [],
        resolvedFeatures: initialAuth.resolvedFeatures,
        isPortalAdmin: initialAuth.resolvedFeatures.some((f) => f === 'portal.*'),
        loading: false,
        error: null,
      }
    }
    if (hasServerData && !initialAuth) {
      // Server confirmed: no auth cookie → not authenticated
      return { user: null, roles: [], resolvedFeatures: [], isPortalAdmin: false, loading: false, error: null }
    }
    // No server data → need client-side fetch
    return { user: null, roles: [], resolvedFeatures: [], isPortalAdmin: false, loading: true, error: null }
  })

  // Client-side profile fetch — only runs when NO server data was provided,
  // or to enrich server-provided auth with full profile (roles, etc.)
  useEffect(() => {
    if (hasServerData && !initialAuth) return // Server said: not authenticated, nothing to fetch
    let cancelled = false

    async function fetchProfile() {
      try {
        const { ok, status, result: data } = await apiCall<{ ok: boolean; user: CustomerAuthResult['user']; roles: CustomerAuthResult['roles']; resolvedFeatures: string[]; isPortalAdmin: boolean }>('/api/customer_accounts/portal/profile')
        if (cancelled) return
        if (status === 401) {
          setAuthState((prev) => ({ ...prev, loading: false, user: prev.user }))
          return
        }
        if (!ok || !data?.ok) {
          setAuthState((prev) => ({ ...prev, loading: false }))
          return
        }
        setAuthState({
          user: data!.user,
          roles: data!.roles || [],
          resolvedFeatures: data!.resolvedFeatures || [],
          isPortalAdmin: data!.isPortalAdmin || false,
          loading: false,
          error: null,
        })
      } catch {
        if (!cancelled) {
          setAuthState((prev) => ({ ...prev, loading: false }))
        }
      }
    }

    fetchProfile()
    return () => { cancelled = true }
  }, [hasServerData, initialAuth])

  const logout = useCallback(async () => {
    try {
      await apiCall('/api/customer_accounts/portal/logout', { method: 'POST' })
    } catch {
      // Best-effort logout — redirect regardless
    }
    setAuthState({ user: null, roles: [], resolvedFeatures: [], isPortalAdmin: false, loading: false, error: null })
    window.location.assign(`/${orgSlug}/portal/login`)
  }, [orgSlug])

  /* ---- Tenant state ---- */
  const [tenantState] = useState<TenantState>(() => {
    if (initialTenant) {
      return {
        tenantId: initialTenant.tenantId,
        organizationId: initialTenant.organizationId,
        organizationName: initialTenant.organizationName,
        loading: false,
        error: null,
      }
    }
    return { tenantId: undefined, organizationId: undefined, organizationName: undefined, loading: true, error: null }
  })

  // Client-side tenant fetch — only when no server data
  useEffect(() => {
    if (initialTenant) return // Server already resolved
    // Fallback: kept for backward compat but shouldn't be hit when layout provides data
  }, [initialTenant])

  const value: PortalContextValue = {
    auth: { ...authState, logout },
    tenant: tenantState,
    orgSlug,
  }

  return <PortalCtx.Provider value={value}>{children}</PortalCtx.Provider>
}
