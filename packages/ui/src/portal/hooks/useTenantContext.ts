"use client"
import { useEffect, useState } from 'react'

type OrgContext = {
  tenantId: string | undefined
  organizationId: string | undefined
  organizationName: string | undefined
  loading: boolean
  error: string | null
}

/**
 * Client-side hook for resolving organization/tenant context by slug.
 *
 * Used in portal pages before login/signup to resolve the tenant and organization
 * from the URL slug via `/api/directory/organizations/lookup`.
 *
 * @param orgSlug - Organization slug from the URL
 *
 * @example
 * ```tsx
 * import { useTenantContext } from '@open-mercato/ui/portal/hooks/useTenantContext'
 *
 * function LoginPage({ orgSlug }: { orgSlug: string }) {
 *   const { tenantId, organizationId, organizationName, loading, error } = useTenantContext(orgSlug)
 *   if (loading) return <LoadingMessage />
 *   if (error) return <ErrorMessage error={error} />
 *   // ...
 * }
 * ```
 */
export function useTenantContext(orgSlug: string): OrgContext {
  const [state, setState] = useState<OrgContext>({
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
        setState((prev) => ({ ...prev, loading: false, error: 'No organization slug provided.' }))
        return
      }

      try {
        const res = await fetch(`/api/directory/organizations/lookup?slug=${encodeURIComponent(orgSlug)}`)
        if (cancelled) return

        if (!res.ok) {
          const data = await res.json().catch(() => null)
          setState((prev) => ({
            ...prev,
            loading: false,
            error: data?.error || 'Organization not found.',
          }))
          return
        }

        const data = await res.json()
        if (!data.ok || !data.organization) {
          setState((prev) => ({ ...prev, loading: false, error: 'Organization not found.' }))
          return
        }

        setState({
          tenantId: data.organization.tenantId ?? undefined,
          organizationId: data.organization.id,
          organizationName: data.organization.name,
          loading: false,
          error: null,
        })
      } catch {
        if (!cancelled) {
          setState((prev) => ({ ...prev, loading: false, error: 'Failed to load organization.' }))
        }
      }
    }

    lookup()
    return () => { cancelled = true }
  }, [orgSlug])

  return state
}
