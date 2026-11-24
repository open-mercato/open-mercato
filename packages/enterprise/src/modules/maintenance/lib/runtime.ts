import { randomUUID } from 'node:crypto'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { secretEqual } from '@open-mercato/core/modules/customer_accounts/lib/secretCompare'
import { MAINTENANCE_MODE_ERROR_CODE, type MaintenanceProcessKind } from '@open-mercato/shared/lib/maintenance/types'
import type { RequestGate, RequestGateContext, RequestGateDecision } from '@open-mercato/shared/lib/runtime/request-gate'
import type { WorkerGate, WorkerGateInfo } from '@open-mercato/shared/lib/runtime/worker-gate'
import { resolveMaintenanceConfig, type MaintenanceConfig } from './config'
import { createInitialState, type MaintenanceProcessRecord, type MaintenanceStateV1 } from './state'
import { createMaintenanceStore, type MaintenanceStateStore } from './store'
import { computeRetryAfterSeconds } from './transitions'
import { STALE_HEARTBEAT_MULTIPLIER } from './drain'
import {
  BYPASS_COOKIE_NAME,
  BYPASS_HEADER_NAME,
  BYPASS_PATH,
  checkBypassToken,
} from './bypass'
import { renderMaintenancePage } from './page/render'
import { resolveMaintenanceTranslations } from './page/i18n'
import { buildPageContentSecurityPolicy, renderBypassForm } from './page/bypass-form'

const logger = createLogger('maintenance').child({ component: 'gate' })

export const MAINTENANCE_GATE_ID = 'enterprise.maintenance'
export const MAINTENANCE_STATUS_PATH = '/api/maintenance/status'
const DOMAIN_RESOLVE_PATH = '/api/customer_accounts/domain-resolve'
const BYPASS_ATTEMPT_WINDOW_MS = 60_000
const BYPASS_ATTEMPT_LIMIT = 10
const BYPASS_ATTEMPT_KEYS_MAX = 10_000

export type DecisionStateSource = 'store' | 'env' | 'sticky' | 'failsafe'

export type DecisionState = {
  state: MaintenanceStateV1
  source: DecisionStateSource
}

type CachedState = {
  state: MaintenanceStateV1
  fetchedAt: number
  source: DecisionStateSource
}

type Agent = {
  kind: MaintenanceProcessKind
  timer: ReturnType<typeof setInterval>
}

export type MaintenanceRuntime = {
  config: MaintenanceConfig
  processId: string
  startedAt: string
  cache: CachedState | null
  refreshing: Promise<CachedState | null> | null
  inflight: number
  ackedGateRevision: number
  agent: Agent | null
  storePromise: Promise<MaintenanceStateStore> | null
  bypassAttempts: Map<string, { count: number; resetAt: number }>
}

const RUNTIME_KEY = '__openMercatoMaintenanceRuntime__'
type RuntimeGlobal = typeof globalThis & { [RUNTIME_KEY]?: MaintenanceRuntime }

export function getMaintenanceRuntime(): MaintenanceRuntime {
  const scope = globalThis as RuntimeGlobal
  if (!scope[RUNTIME_KEY]) {
    scope[RUNTIME_KEY] = {
      config: resolveMaintenanceConfig(),
      processId: `${resolveMaintenanceConfig().host}:${process.pid}:${randomUUID().slice(0, 8)}`,
      startedAt: new Date().toISOString(),
      cache: null,
      refreshing: null,
      inflight: 0,
      ackedGateRevision: -1,
      agent: null,
      storePromise: null,
      bypassAttempts: new Map(),
    }
  }
  return scope[RUNTIME_KEY]!
}

export function resetMaintenanceRuntimeForTests(overrides: { config?: MaintenanceConfig; store?: MaintenanceStateStore } = {}): MaintenanceRuntime {
  const scope = globalThis as RuntimeGlobal
  const previous = scope[RUNTIME_KEY]
  if (previous?.agent) clearInterval(previous.agent.timer)
  delete scope[RUNTIME_KEY]
  const runtime = getMaintenanceRuntime()
  if (overrides.config) runtime.config = overrides.config
  if (overrides.store) runtime.storePromise = Promise.resolve(overrides.store)
  return runtime
}

export function getMaintenanceStore(runtime: MaintenanceRuntime = getMaintenanceRuntime()): Promise<MaintenanceStateStore> {
  if (!runtime.storePromise) {
    runtime.storePromise = createMaintenanceStore(runtime.config).catch((error) => {
      runtime.storePromise = null
      throw error
    })
  }
  return runtime.storePromise
}

function failsafeState(reason: string): MaintenanceStateV1 {
  logger.error('Maintenance state is unreadable; failing safe and gating traffic', { reason })
  return { ...createInitialState(), active: true, windowId: 'unknown', epoch: -1 }
}

async function fetchState(runtime: MaintenanceRuntime): Promise<CachedState | null> {
  const previous = runtime.cache
  try {
    const store = await getMaintenanceStore(runtime)
    const read = await store.readState()
    if (read.kind === 'ok') {
      return { state: read.state, fetchedAt: Date.now(), source: 'store' }
    }
    if (read.kind === 'unsupported') {
      return { state: failsafeState(read.reason), fetchedAt: Date.now(), source: 'failsafe' }
    }
    if (previous?.state.active) {
      logger.error('Maintenance state key vanished while a window is known to be active; keeping the last known state')
      return { ...previous, fetchedAt: Date.now(), source: 'sticky' }
    }
    return { state: createInitialState(), fetchedAt: Date.now(), source: 'store' }
  } catch (error) {
    if (previous) {
      logger.warn('Maintenance state store unreachable; keeping the last known state', { err: error })
      return { ...previous, fetchedAt: Date.now(), source: 'sticky' }
    }
    logger.error('Maintenance state store unreachable and no state is known; failing open', { err: error })
    return null
  }
}

/** Refreshes the cached state when it is older than the poll interval (or when forced). */
export async function refreshMaintenanceState(force = false, runtime: MaintenanceRuntime = getMaintenanceRuntime()): Promise<CachedState | null> {
  const fresh = runtime.cache && Date.now() - runtime.cache.fetchedAt < runtime.config.pollMs
  if (fresh && !force) return runtime.cache
  if (!runtime.refreshing) {
    runtime.refreshing = fetchState(runtime)
      .then((next) => {
        if (next) runtime.cache = next
        return next
      })
      .finally(() => {
        runtime.refreshing = null
      })
  }
  return runtime.refreshing
}

function forcedState(runtime: MaintenanceRuntime): MaintenanceStateV1 {
  const base = runtime.cache?.state
  return {
    ...(base ?? createInitialState()),
    active: true,
    windowId: base?.active ? base.windowId : 'env',
    bypass: { enabled: false, tokenSha256: null, expiresAt: null },
  }
}

export async function resolveDecisionState(runtime: MaintenanceRuntime = getMaintenanceRuntime()): Promise<DecisionState | null> {
  if (runtime.config.force) {
    void refreshMaintenanceState(false, runtime).catch(() => null)
    return { state: forcedState(runtime), source: 'env' }
  }
  const cached = await refreshMaintenanceState(false, runtime)
  if (!cached) return null
  return { state: cached.state, source: cached.source }
}

/** Synchronous view used by worker gates; schedules a refresh when stale. */
export function peekDecisionState(runtime: MaintenanceRuntime = getMaintenanceRuntime()): MaintenanceStateV1 | null {
  if (runtime.config.force) return forcedState(runtime)
  if (!runtime.cache || Date.now() - runtime.cache.fetchedAt >= runtime.config.pollMs) {
    void refreshMaintenanceState(false, runtime).catch(() => null)
  }
  return runtime.cache?.state ?? null
}

function gateHeaders(retryAfter: number, extra: Record<string, string> = {}): Headers {
  return new Headers({
    'Retry-After': String(retryAfter),
    'Cache-Control': 'no-store',
    'X-Maintenance-Mode': '1',
    ...extra,
  })
}

async function buildApiResponse(state: MaintenanceStateV1, ctx: RequestGateContext, now: Date): Promise<Response> {
  const retryAfter = computeRetryAfterSeconds(state, now)
  const { t } = await resolveMaintenanceTranslations(ctx.headers.get('accept-language'))
  const body = {
    error: t('maintenance.api.unavailable', 'Service temporarily unavailable for maintenance.'),
    code: MAINTENANCE_MODE_ERROR_CODE,
    retryAfter,
    until: state.until,
  }
  return new Response(JSON.stringify(body), {
    status: 503,
    headers: gateHeaders(retryAfter, { 'Content-Type': 'application/json; charset=utf-8' }),
  })
}

export async function buildPageResponse(state: MaintenanceStateV1, acceptLanguage: string | null, now: Date, runtime: MaintenanceRuntime = getMaintenanceRuntime()): Promise<Response> {
  const retryAfter = computeRetryAfterSeconds(state, now)
  const { locale, t } = await resolveMaintenanceTranslations(acceptLanguage)
  const html = renderMaintenancePage({
    locale,
    t,
    title: state.page.title,
    message: state.page.message,
    until: state.until,
    retryAfterSeconds: retryAfter,
    timezone: runtime.config.timezone,
    logoUrl: runtime.config.logoUrl,
    supportUrl: runtime.config.supportUrl,
    templatePath: runtime.config.templatePath,
    now,
  })
  return new Response(html, {
    status: 503,
    headers: gateHeaders(retryAfter, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': buildPageContentSecurityPolicy(html),
    }),
  })
}

function isExemptApiRequest(ctx: RequestGateContext): boolean {
  const method = ctx.method.toUpperCase()
  if (method === 'OPTIONS') return true
  if (ctx.pathname === MAINTENANCE_STATUS_PATH && (method === 'GET' || method === 'HEAD')) return true
  if (ctx.pathname === DOMAIN_RESOLVE_PATH) {
    const expected = process.env.DOMAIN_RESOLVE_SECRET?.trim()
    if (expected && secretEqual(ctx.headers.get('x-domain-resolve-secret'), expected)) return true
  }
  return false
}

function clientKey(ctx: RequestGateContext): string {
  const forwarded = ctx.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return forwarded || ctx.headers.get('x-real-ip') || 'unknown'
}

function consumeBypassAttempt(runtime: MaintenanceRuntime, key: string): boolean {
  const now = Date.now()
  const entry = runtime.bypassAttempts.get(key)
  if (!entry || entry.resetAt <= now) {
    if (runtime.bypassAttempts.size >= BYPASS_ATTEMPT_KEYS_MAX) {
      for (const [candidate, value] of runtime.bypassAttempts) {
        if (value.resetAt <= now) runtime.bypassAttempts.delete(candidate)
      }
      if (runtime.bypassAttempts.size >= BYPASS_ATTEMPT_KEYS_MAX) return false
    }
    runtime.bypassAttempts.set(key, { count: 1, resetAt: now + BYPASS_ATTEMPT_WINDOW_MS })
    return true
  }
  entry.count += 1
  return entry.count <= BYPASS_ATTEMPT_LIMIT
}

async function readBypassFormToken(request: Request | undefined): Promise<string | null> {
  if (!request) return null
  const contentType = request.headers.get('content-type') ?? ''
  if (!contentType.toLowerCase().startsWith('application/x-www-form-urlencoded')) return null
  try {
    const text = await request.clone().text()
    if (text.length > 4096) return null
    const token = new URLSearchParams(text).get('token')
    return token ? token.trim() : null
  } catch {
    return null
  }
}

function bypassCookieMaxAgeSeconds(state: MaintenanceStateV1, now: Date): number {
  if (!state.bypass.expiresAt) return 2 * 60 * 60
  return Math.max(60, Math.floor((Date.parse(state.bypass.expiresAt) - now.getTime()) / 1000))
}

async function handleBypassPage(state: MaintenanceStateV1, ctx: RequestGateContext, now: Date, runtime: MaintenanceRuntime): Promise<Response> {
  const { locale, t } = await resolveMaintenanceTranslations(ctx.headers.get('accept-language'))
  const method = ctx.method.toUpperCase()
  if (method !== 'POST') {
    const html = renderBypassForm({ locale, t, error: null })
    return new Response(html, {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': buildPageContentSecurityPolicy(html) },
    })
  }
  const rejectForm = (status: number, error: string) => {
    const html = renderBypassForm({ locale, t, error })
    return new Response(html, {
      status,
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': buildPageContentSecurityPolicy(html) },
    })
  }
  if (!consumeBypassAttempt(runtime, clientKey(ctx))) {
    return rejectForm(429, t('maintenance.bypass.tooManyAttempts', 'Too many attempts. Wait a minute and try again.'))
  }
  const token = await readBypassFormToken(ctx.request)
  const check = checkBypassToken(state, token, now)
  if (!check.ok) {
    logger.warn('Maintenance bypass attempt refused', { reason: check.reason })
    return rejectForm(403, t('maintenance.bypass.invalid', 'This bypass token is not valid for the current maintenance window.'))
  }
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  const cookie = `${BYPASS_COOKIE_NAME}=${encodeURIComponent(token!)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${bypassCookieMaxAgeSeconds(state, now)}${secure}`
  logger.info('Maintenance bypass session granted', { windowId: state.windowId })
  return new Response(null, {
    status: 303,
    headers: { Location: resolveBypassRedirect(ctx), 'Set-Cookie': cookie, 'Cache-Control': 'no-store' },
  })
}

/** Next's proxy rejects relative redirect targets, so the bypass redirect is always absolute. */
export function resolveBypassRedirect(ctx: RequestGateContext): string {
  const base = ctx.request?.url
  if (base) {
    try {
      return new URL('/backend', base).toString()
    } catch {
      return '/backend'
    }
  }
  const host = ctx.headers.get('host')
  if (!host) return '/backend'
  const proto = ctx.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() || 'http'
  return `${proto}://${host}/backend`
}

function readBypassCredential(ctx: RequestGateContext): string | null {
  const header = ctx.headers.get(BYPASS_HEADER_NAME)
  if (header && header.trim()) return header.trim()
  const cookie = ctx.cookies.get(BYPASS_COOKIE_NAME)
  return cookie && cookie.trim() ? cookie.trim() : null
}

export async function evaluateMaintenanceGate(ctx: RequestGateContext, runtime: MaintenanceRuntime = getMaintenanceRuntime()): Promise<RequestGateDecision> {
  ensureWebAgent(runtime)
  const decision = await resolveDecisionState(runtime)
  if (!decision || !decision.state.active) return null
  const state = decision.state
  const now = new Date()
  if (ctx.surface === 'api' && isExemptApiRequest(ctx)) return null
  if (ctx.surface === 'page' && ctx.pathname === BYPASS_PATH) {
    if (decision.source === 'env') return { response: await buildPageResponse(state, ctx.headers.get('accept-language'), now, runtime) }
    return { response: await handleBypassPage(state, ctx, now, runtime) }
  }
  const credential = readBypassCredential(ctx)
  if (credential && decision.source !== 'env') {
    const check = checkBypassToken(state, credential, now)
    if (check.ok) {
      logger.info('Maintenance bypass request admitted', { surface: ctx.surface, method: ctx.method, pathname: ctx.pathname })
      return null
    }
  }
  if (ctx.surface === 'api') return { response: await buildApiResponse(state, ctx, now) }
  return { response: await buildPageResponse(state, ctx.headers.get('accept-language'), now, runtime) }
}

export function createMaintenanceRequestGate(): RequestGate {
  return {
    id: MAINTENANCE_GATE_ID,
    priority: 1000,
    evaluate: (ctx) => evaluateMaintenanceGate(ctx),
    onAdmitted: () => {
      const runtime = getMaintenanceRuntime()
      runtime.inflight += 1
      return () => {
        runtime.inflight = Math.max(0, runtime.inflight - 1)
      }
    },
  }
}

export function createMaintenanceWorkerGate(): WorkerGate {
  return {
    id: MAINTENANCE_GATE_ID,
    shouldPause: () => peekDecisionState()?.active === true,
    onPaused: (info: WorkerGateInfo) => logger.info('Work paused for maintenance', { kind: info.kind, queueName: info.queueName }),
    onResumed: (info: WorkerGateInfo) => logger.info('Work resumed after maintenance', { kind: info.kind, queueName: info.queueName }),
    onJobStarted: () => {
      const runtime = getMaintenanceRuntime()
      runtime.inflight += 1
      return () => {
        runtime.inflight = Math.max(0, runtime.inflight - 1)
      }
    },
    onRunnerStarted: (info: WorkerGateInfo) => {
      startMaintenanceAgent(info.kind === 'scheduler' ? 'scheduler' : 'worker')
    },
  }
}

export function buildProcessRecord(runtime: MaintenanceRuntime, kind: MaintenanceProcessKind, heartbeatAt: Date): MaintenanceProcessRecord {
  return {
    processId: runtime.processId,
    kind,
    host: runtime.config.host,
    pid: process.pid,
    startedAt: runtime.startedAt,
    ackedGateRevision: runtime.ackedGateRevision,
    loadedGeneration: runtime.startedAt,
    inflight: runtime.inflight,
    heartbeatAt: heartbeatAt.toISOString(),
  }
}

/** One heartbeat: adopt the latest gate revision, then publish revision and counters together. */
export async function heartbeatOnce(runtime: MaintenanceRuntime = getMaintenanceRuntime()): Promise<boolean> {
  const agent = runtime.agent
  if (!agent) return false
  const refreshed = await refreshMaintenanceState(true, runtime)
  if (!refreshed || refreshed.source !== 'store') return false
  runtime.ackedGateRevision = refreshed.state.gateRevision
  try {
    const store = await getMaintenanceStore(runtime)
    const now = await store.now()
    await store.writeProcess(buildProcessRecord(runtime, agent.kind, now), runtime.config.heartbeatMs * STALE_HEARTBEAT_MULTIPLIER)
    return true
  } catch (error) {
    logger.warn('Maintenance heartbeat failed', { err: error })
    return false
  }
}

const KIND_PRIORITY: Record<MaintenanceProcessKind, number> = { web: 3, scheduler: 2, worker: 1 }

export function startMaintenanceAgent(kind: MaintenanceProcessKind, runtime: MaintenanceRuntime = getMaintenanceRuntime()): void {
  if (runtime.agent) {
    if (KIND_PRIORITY[kind] > KIND_PRIORITY[runtime.agent.kind]) runtime.agent.kind = kind
    return
  }
  const timer = setInterval(() => {
    void heartbeatOnce(runtime).catch(() => false)
  }, runtime.config.heartbeatMs)
  if (typeof timer.unref === 'function') timer.unref()
  runtime.agent = { kind, timer }
  void heartbeatOnce(runtime).catch(() => false)
}

export function stopMaintenanceAgent(runtime: MaintenanceRuntime = getMaintenanceRuntime()): void {
  if (!runtime.agent) return
  clearInterval(runtime.agent.timer)
  runtime.agent = null
}

function isNextServerRuntime(): boolean {
  return process.env.NEXT_RUNTIME === 'nodejs' && process.env.NEXT_PHASE !== 'phase-production-build'
}

function ensureWebAgent(runtime: MaintenanceRuntime): void {
  if (!runtime.agent && isNextServerRuntime()) startMaintenanceAgent('web', runtime)
}

export function startWebAgentIfServerRuntime(): void {
  if (isNextServerRuntime()) startMaintenanceAgent('web')
}
