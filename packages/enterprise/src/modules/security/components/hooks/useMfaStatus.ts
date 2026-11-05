'use client'

import * as React from 'react'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import type { MfaMethod, MfaProvider } from '../../types'

type MfaMethodsResponse = {
  methods?: MfaMethod[]
}

type MfaProvidersResponse = {
  providers?: MfaProvider[]
}

type RecoveryResponse = {
  recoveryCodes?: string[]
}

type UseMfaStatusResult = {
  loading: boolean
  saving: boolean
  methods: MfaMethod[]
  providers: MfaProvider[]
  recoveryCodes: string[]
  reload: () => Promise<void>
  removeMethod: (methodId: string) => Promise<void>
  regenerateRecoveryCodes: () => Promise<void>
  setRecoveryCodes: (codes: string[]) => void
}

export function useMfaStatus(): UseMfaStatusResult {
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [methods, setMethods] = React.useState<MfaMethod[]>([])
  const [providers, setProviders] = React.useState<MfaProvider[]>([])
  const [recoveryCodes, setRecoveryCodes] = React.useState<string[]>([])

  const reload = React.useCallback(async () => {
    setLoading(true)
    try {
      const [methodsResult, providersResult] = await Promise.all([
        apiCall<MfaMethodsResponse>('/api/security/mfa/methods'),
        apiCall<MfaProvidersResponse>('/api/security/mfa/providers'),
      ])

      setMethods(Array.isArray(methodsResult.result?.methods) ? methodsResult.result?.methods ?? [] : [])
      setProviders(Array.isArray(providersResult.result?.providers) ? providersResult.result?.providers ?? [] : [])
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void reload()
  }, [reload])

  const removeMethod = React.useCallback(async (methodId: string) => {
    setSaving(true)
    try {
      await readApiResultOrThrow<{ ok: true }>(
        `/api/security/mfa/methods/${encodeURIComponent(methodId)}`,
        { method: 'DELETE' },
      )
      await reload()
    } finally {
      setSaving(false)
    }
  }, [reload])

  const regenerateRecoveryCodes = React.useCallback(async () => {
    setSaving(true)
    try {
      const result = await readApiResultOrThrow<RecoveryResponse>(
        '/api/security/mfa/recovery-codes/regenerate',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({}),
        },
      )
      const codes = Array.isArray(result?.recoveryCodes) ? result.recoveryCodes : []
      setRecoveryCodes(codes)
    } finally {
      setSaving(false)
    }
  }, [])

  return {
    loading,
    saving,
    methods,
    providers,
    recoveryCodes,
    reload,
    removeMethod,
    regenerateRecoveryCodes,
    setRecoveryCodes,
  }
}
