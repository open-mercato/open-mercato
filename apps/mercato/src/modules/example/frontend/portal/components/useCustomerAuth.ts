"use client"
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

type CustomerUser = {
  id: string
  email: string
  displayName: string
  emailVerified: boolean
  customerEntityId: string | null
  personEntityId: string | null
  isActive: boolean
  lastLoginAt: string | null
  createdAt: string
}

type CustomerRole = {
  id: string
  name: string
  slug: string
}

type AuthState = {
  user: CustomerUser | null
  roles: CustomerRole[]
  resolvedFeatures: string[]
  isPortalAdmin: boolean
  loading: boolean
  error: string | null
}

export function useCustomerAuth(orgSlug?: string) {
  const router = useRouter()
  const [state, setState] = useState<AuthState>({
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
          setState((prev) => ({ ...prev, loading: false, user: null }))
          return
        }

        if (!res.ok) {
          setState((prev) => ({ ...prev, loading: false, error: `HTTP ${res.status}` }))
          return
        }

        const data = await res.json()
        if (!data.ok) {
          setState((prev) => ({ ...prev, loading: false, error: data.error || 'Unknown error' }))
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
      await fetch('/api/customer_accounts/portal/logout', {
        method: 'POST',
        credentials: 'include',
      })
    } catch {
      // Best effort
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
