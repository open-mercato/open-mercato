import { randomUUID } from 'node:crypto'
import {
  OAuthGrantError,
  type OAuthGrantOwner,
  type OAuthGrantReadStatus,
  type OAuthProviderDescriptor,
} from '@open-mercato/core/modules/integrations/lib/oauth/descriptor'
import type {
  IntegrationOAuthGrantService,
  OAuthAccessToken,
  OAuthConnectResult,
  OAuthDisconnectResult,
  OAuthGrantInspection,
  OAuthLastDisconnect,
} from '@open-mercato/core/modules/integrations/lib/oauth/grant-service'
import { assertOptimisticLock } from '@open-mercato/shared/lib/crud/optimistic-lock-command'

type GrantErrorCode = ConstructorParameters<typeof OAuthGrantError>[0]
type GrantErrorOptions = ConstructorParameters<typeof OAuthGrantError>[1]

export type FakeGrantStatus = 'none' | 'active' | 'invalidated' | 'unavailable'

export type FakeGrantState = {
  status: FakeGrantStatus
  accessToken: string | null
  expiresAt: Date
  obtainedAt: Date
  refreshedAt: Date | null
  revisedAt: Date
  providerData: Record<string, unknown> | null
  previousProviderData: Record<string, unknown> | null
  grantedScopes: string[]
  clientChanged: boolean
  lastFailureClass: 'transient' | 'client_misconfigured' | null
  missingScopes: string[]
  unavailableReason: 'unreadable' | 'platform' | null
  baseUrlMissing: boolean
  lastDisconnect: OAuthLastDisconnect | null
  issuedTokens: string[]
}

export type FakeGrantCall = { method: keyof IntegrationOAuthGrantService; options?: unknown }

export type FakeGrantServiceOptions = {
  now?: () => Date
  accessTokenTtlMs?: number
  connected?: boolean
  providerData?: Record<string, unknown> | null
  tokenFactory?: (sequence: number) => string
}

export type FakeGrantService = {
  service: IntegrationOAuthGrantService
  state: FakeGrantState
  calls: FakeGrantCall[]
  connect(providerData?: Record<string, unknown> | null): void
  rotate(): string
  setStatus(status: FakeGrantStatus): void
  failNext(method: 'getAccessToken' | 'updateProviderData' | 'disconnect' | 'completeConnect', code: GrantErrorCode, options?: GrantErrorOptions): void
  failWith(method: 'getAccessToken' | 'updateProviderData' | 'disconnect' | 'completeConnect', error: Error): void
  isTokenValid(token: string): boolean
}

const DEFAULT_TTL_MS = 30 * 60 * 1000
const DEFAULT_SCOPES = ['offline_access', 'accounting.contacts.read', 'accounting.invoices.read']

export function createFakeGrantService(options: FakeGrantServiceOptions = {}): FakeGrantService {
  const now = options.now ?? (() => new Date())
  const ttlMs = options.accessTokenTtlMs ?? DEFAULT_TTL_MS
  const tokenFactory = options.tokenFactory ?? ((sequence: number) => `fake-access-${sequence}-${randomUUID()}`)
  let sequence = 0
  const calls: FakeGrantCall[] = []
  const queuedFailures = new Map<string, Error[]>()
  const start = now()
  const state: FakeGrantState = {
    status: 'none',
    accessToken: null,
    expiresAt: start,
    obtainedAt: start,
    refreshedAt: null,
    revisedAt: start,
    providerData: null,
    previousProviderData: null,
    grantedScopes: [...DEFAULT_SCOPES],
    clientChanged: false,
    lastFailureClass: null,
    missingScopes: [],
    unavailableReason: null,
    baseUrlMissing: false,
    lastDisconnect: null,
    issuedTokens: [],
  }

  function issueToken(): string {
    sequence += 1
    const token = tokenFactory(sequence)
    state.accessToken = token
    state.expiresAt = new Date(now().getTime() + ttlMs)
    state.issuedTokens.push(token)
    return token
  }

  function takeFailure(method: string): void {
    const queue = queuedFailures.get(method)
    const failure = queue?.shift()
    if (failure) throw failure
  }

  function connect(providerData: Record<string, unknown> | null = null): void {
    state.status = 'active'
    state.obtainedAt = now()
    state.refreshedAt = null
    state.revisedAt = new Date(now().getTime() + sequence)
    state.providerData = providerData
    state.lastDisconnect = null
    issueToken()
  }

  function rotate(): string {
    state.refreshedAt = now()
    return issueToken()
  }

  if (options.connected) connect(options.providerData ?? null)

  const service: IntegrationOAuthGrantService = {
    async getAccessToken(_descriptor: OAuthProviderDescriptor, _owner: OAuthGrantOwner, callOptions) {
      calls.push({ method: 'getAccessToken', options: callOptions })
      takeFailure('getAccessToken')
      if (state.status === 'none') throw new OAuthGrantError('not_connected')
      if (state.status === 'invalidated') throw new OAuthGrantError('grant_invalidated', { reason: 'grant_rejected' })
      if (state.status === 'unavailable') throw new OAuthGrantError('platform_unavailable')
      const minValidityMs = callOptions?.minValidityMs ?? 120_000
      const rejected = callOptions?.rejectedAccessToken !== undefined && callOptions.rejectedAccessToken === state.accessToken
      const expiring = state.expiresAt.getTime() - now().getTime() < minValidityMs
      if (callOptions?.forceRefresh || rejected || expiring || !state.accessToken) rotate()
      const result: OAuthAccessToken = {
        accessToken: state.accessToken as string,
        expiresAt: state.expiresAt,
        degraded: false,
        grantedScopes: [...state.grantedScopes],
        providerData: state.providerData,
      }
      return result
    },
    async completeConnect(_descriptor, _owner, _tokenResponse, callOptions) {
      calls.push({ method: 'completeConnect', options: callOptions })
      takeFailure('completeConnect')
      const reconnect = state.status !== 'none'
      const previousProviderData = state.providerData && Object.keys(state.providerData).length > 0 ? state.providerData : state.previousProviderData
      state.previousProviderData = previousProviderData
      connect(null)
      state.revisedAt = new Date(now().getTime() + sequence)
      const result: OAuthConnectResult = {
        reconnect,
        replacedUnreadable: callOptions.replaceUnreadable === true && state.unavailableReason === 'unreadable',
        previousProviderData,
        revisedAt: state.revisedAt,
      }
      state.unavailableReason = null
      return result
    },
    async updateProviderData(_descriptor, owner, data, callOptions) {
      calls.push({ method: 'updateProviderData', options: { data, ...callOptions } })
      takeFailure('updateProviderData')
      if (state.status === 'none') throw new OAuthGrantError('not_connected')
      if (state.status === 'unavailable') throw new OAuthGrantError('platform_unavailable')
      assertOptimisticLock({
        resourceKind: 'integrations.oauth_grant',
        resourceId: owner.integrationId,
        expected: callOptions.expectedRevisedAt,
        current: state.revisedAt,
        envValue: 'on',
      })
      state.providerData = { ...data }
      state.previousProviderData = null
      state.revisedAt = new Date(state.revisedAt.getTime() + 1000)
      return { revisedAt: state.revisedAt }
    },
    async inspectGrant() {
      calls.push({ method: 'inspectGrant' })
      if (state.status === 'none') {
        const inspection: OAuthGrantInspection = {
          status: 'none',
          connectionState: 'not_connected',
          unavailableReason: null,
          baseUrlMissing: state.baseUrlMissing,
          lastDisconnect: state.lastDisconnect,
        }
        return inspection
      }
      if (state.status === 'unavailable') {
        const inspection: OAuthGrantInspection = {
          status: 'unavailable',
          connectionState: 'unavailable',
          unavailableReason: state.unavailableReason ?? 'platform',
          baseUrlMissing: state.baseUrlMissing,
        }
        return inspection
      }
      const inspection: OAuthGrantInspection = {
        status: state.status,
        connectionState: state.status,
        unavailableReason: null,
        baseUrlMissing: state.baseUrlMissing,
        expiresAt: state.expiresAt,
        refreshedAt: state.refreshedAt,
        obtainedAt: state.obtainedAt,
        revisedAt: state.revisedAt,
        lastFailureClass: state.lastFailureClass,
        lastFailureAt: state.lastFailureClass ? now() : null,
        clientChanged: state.clientChanged,
        missingScopes: [...state.missingScopes],
        hasExternalAccount: state.providerData !== null && Object.keys(state.providerData).length > 0,
        providerData: state.providerData,
        previousProviderData: state.previousProviderData,
        accessToken: state.expiresAt.getTime() > now().getTime() ? state.accessToken : null,
      }
      return inspection
    },
    async readGrantStatus() {
      calls.push({ method: 'readGrantStatus' })
      const status: OAuthGrantReadStatus | null = state.status === 'none' ? null : state.status
      return status
    },
    async disconnect(_descriptor, owner, callOptions) {
      calls.push({ method: 'disconnect', options: callOptions })
      takeFailure('disconnect')
      if (state.status === 'none') {
        const result: OAuthDisconnectResult = { erased: false, reason: 'not_connected' }
        return result
      }
      if (state.status === 'unavailable' && !callOptions.force) throw new OAuthGrantError('disconnect_tokens_unreadable')
      if (!callOptions.force) {
        assertOptimisticLock({
          resourceKind: 'integrations.oauth_grant',
          resourceId: owner.integrationId,
          expected: callOptions.expectedRevisedAt,
          current: state.revisedAt,
          envValue: 'on',
        })
      }
      const revocation = callOptions.force ? 'failed' : state.status === 'invalidated' ? 'skipped_invalidated' : 'confirmed'
      const disconnectId = randomUUID()
      state.status = 'none'
      state.accessToken = null
      state.previousProviderData = state.providerData
      state.providerData = null
      state.lastDisconnect = { at: now(), disconnectId, revocation: revocation === 'skipped_invalidated' ? 'skipped' : revocation }
      const result: OAuthDisconnectResult = {
        erased: true,
        disconnectId,
        revocation,
        failureReason: callOptions.force ? 'undecryptable' : null,
      }
      return result
    },
  }

  return {
    service,
    state,
    calls,
    connect,
    rotate,
    setStatus(status) {
      state.status = status
    },
    failNext(method, code, errorOptions) {
      const queue = queuedFailures.get(method) ?? []
      queue.push(new OAuthGrantError(code, errorOptions))
      queuedFailures.set(method, queue)
    },
    failWith(method, error) {
      const queue = queuedFailures.get(method) ?? []
      queue.push(error)
      queuedFailures.set(method, queue)
    },
    isTokenValid(token) {
      return state.status === 'active' && token === state.accessToken && state.expiresAt.getTime() > now().getTime()
    },
  }
}
