"use client"
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { CustomerUser, CustomerRole, CustomerAuthResult } from '@open-mercato/shared/modules/customer-auth'
import { apiCall } from '../../backend/utils/apiCall'

export type { CustomerUser, CustomerRole, CustomerAuthResult }

/**
 * Client-side hook for customer portal authentication.
 *
 * Fetches the authenticated customer profile from `/api/customer_accounts/portal/profile`
 * and provides auth state + logout capability.
 *
 * @param orgSlug - Optional organization slug for redirect paths
 *
 * @example
 * ```tsx
 * import { useCustomerAuth } from '@open-mercato/ui/portal/hooks/useCustomerAuth'
 *
 * function MyPortalPage({ orgSlug }: { orgSlug: string }) {
 *   const { user, roles, resolvedFeatures, loading, logout } = useCustomerAuth(orgSlug)
 *   if (loading) return <LoadingMessage />
 *   if (!user) return <Redirect to={`/${orgSlug}/portal/login`} />
 *   return <div>Welcome, {user.displayName}</div>
 * }
 * ```
 */
export function useCustomerAuth(orgSlug?: string) {
  const router = useRouter()
  const [state, setState] = useState<CustomerAuthResult>({
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
        const { ok, status, result: data } = await apiCall<{ ok: boolean; user: CustomerAuthResult['user']; roles: CustomerAuthResult['roles']; resolvedFeatures: string[]; isPortalAdmin: boolean; error?: string }>('/api/customer_accounts/portal/profile')
        if (cancelled) return

        if (status === 401) {
          setState((prev) => ({ ...prev, loading: false, user: null }))
          return
        }

        if (!ok || !data?.ok) {
          setState((prev) => ({ ...prev, loading: false, error: data?.error || `HTTP ${status}` }))
          return
        }

        setState({
          user: data.user,
          roles: data.roles || [],
          resolvedFeatures: data.resolvedFeatures || [],
          isPortalAdmin: data.isPortalAdmin || false,
          loading: false,
          error: null,
        })
      } catch {
        if (!cancelled) {
          setState((prev) => ({ ...prev, loading: false, error: 'Network error' }))
        }
      }
    }

    fetchProfile()
    return () => { cancelled = true }
  }, [])

  const loginPath = orgSlug ? `/${orgSlug}/portal/login` : '/portal/login'

  const logout = useCallback(async () => {
    try {
      await apiCall('/api/customer_accounts/portal/logout', { method: 'POST' })
    } catch {
      // Best-effort logout — redirect regardless
    }
    setState({
      user: null,
      roles: [],
      resolvedFeatures: [],
      isPortalAdmin: false,
      loading: false,
      error: null,
    })
    router.push(loginPath)
  }, [router, loginPath])

  return { ...state, logout }
}
