'use client'

import * as React from 'react'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import SudoChallengeModal, { type PendingSudoChallenge } from './SudoChallengeModal'

type SudoTokenCacheEntry = {
  token: string
  expiresAt: number
}

type InitiateResponse = {
  required: boolean
  sessionId?: string
  method?: 'password' | 'mfa'
  availableMfaMethods?: PendingSudoChallenge['availableMfaMethods']
}

export type SudoContextValue = {
  requireSudo: (targetIdentifier: string) => Promise<string | null>
  isSudoActive: boolean
}

export const SudoContext = React.createContext<SudoContextValue | null>(null)

function buildCacheKey(targetIdentifier: string): string {
  return targetIdentifier
}

type SudoProviderProps = {
  children: React.ReactNode
}

export function SudoProvider({ children }: SudoProviderProps) {
  const [pendingChallenge, setPendingChallenge] = React.useState<PendingSudoChallenge | null>(null)
  const pendingResolverRef = React.useRef<((result: string | null) => void) | null>(null)
  const pendingCacheKeyRef = React.useRef<string | null>(null)
  const [tokenCache, setTokenCache] = React.useState<Record<string, SudoTokenCacheEntry>>({})

  const pruneExpiredTokens = React.useCallback(() => {
    const now = Date.now()
    setTokenCache((current) => {
      const nextEntries = Object.entries(current).filter(([, value]) => value.expiresAt > now)
      if (nextEntries.length === Object.keys(current).length) return current
      return Object.fromEntries(nextEntries)
    })
  }, [])

  const requireSudo = React.useCallback<SudoContextValue['requireSudo']>(async (targetIdentifier) => {
    pruneExpiredTokens()
    const cacheKey = buildCacheKey(targetIdentifier)
    const cached = tokenCache[cacheKey]
    if (cached && cached.expiresAt > Date.now()) {
      return cached.token
    }

    const result = await readApiResultOrThrow<InitiateResponse>('/api/security/sudo', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ targetIdentifier }),
    })

    if (!result.required || !result.sessionId || !result.method) {
      return null
    }

    return new Promise<string | null>((resolve) => {
      pendingCacheKeyRef.current = cacheKey
      pendingResolverRef.current = resolve
      setPendingChallenge({
        sessionId: result.sessionId ?? '',
        targetIdentifier,
        method: result.method ?? 'password',
        availableMfaMethods: result.availableMfaMethods ?? [],
      })
    })
  }, [pruneExpiredTokens, tokenCache])

  const handleResolve = React.useCallback((result: { sudoToken: string; expiresAt: string } | null) => {
    const resolve = pendingResolverRef.current
    const cacheKey = pendingCacheKeyRef.current

    pendingResolverRef.current = null
    pendingCacheKeyRef.current = null
    setPendingChallenge(null)

    if (result?.sudoToken && cacheKey) {
      const expiresAt = new Date(result.expiresAt).getTime()
      setTokenCache((current) => ({
        ...current,
        [cacheKey]: { token: result.sudoToken, expiresAt },
      }))
      resolve?.(result.sudoToken)
      return
    }

    resolve?.(null)
  }, [])

  const contextValue = React.useMemo<SudoContextValue>(() => ({
    requireSudo,
    isSudoActive: Object.values(tokenCache).some((entry) => entry.expiresAt > Date.now()),
  }), [requireSudo, tokenCache])

  return (
    <SudoContext.Provider value={contextValue}>
      {children}
      <SudoChallengeModal
        open={pendingChallenge !== null}
        challenge={pendingChallenge}
        onResolve={handleResolve}
      />
    </SudoContext.Provider>
  )
}

export function withSudoProtection<P extends object>(
  Component: React.ComponentType<P & SudoContextValue>,
  options?: {
    targetIdentifier?: string | ((props: P) => string)
  },
) {
  const Wrapped = (props: P) => {
    const context = React.useContext(SudoContext)
    if (!context) {
      throw new Error('withSudoProtection must be used within a SudoProvider')
    }

    const requireSudo = async (targetIdentifier: string) =>
      context.requireSudo(
        options?.targetIdentifier
          ? typeof options.targetIdentifier === 'function'
            ? options.targetIdentifier(props)
            : options.targetIdentifier
          : targetIdentifier,
      )

    return (
      <Component
        {...props}
        requireSudo={requireSudo}
        isSudoActive={context.isSudoActive}
      />
    )
  }

  Wrapped.displayName = `WithSudoProtection(${Component.displayName ?? Component.name ?? 'Component'})`
  return Wrapped
}

export default SudoProvider
