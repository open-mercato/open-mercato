import { createLogger } from '../logger'

export type RequestGateSurface = 'api' | 'page'

export type RequestGateCookies = {
  get(name: string): string | undefined
}

export type RequestGateContext = {
  surface: RequestGateSurface
  method: string
  pathname: string
  headers: Headers
  cookies: RequestGateCookies
}

export type RequestGateDecision = { response: Response } | null

export type RequestGateRelease = () => void

/**
 * Availability gate evaluated before route matching and authentication.
 *
 * Gates are meant for instance-wide availability decisions (maintenance windows,
 * planned outages). They receive no auth context and MUST NOT be used for
 * authorization or business rules. With no gate registered, every call site is a no-op.
 */
export type RequestGate = {
  id: string
  /** Higher priority runs first. Defaults to 0. */
  priority?: number
  evaluate(ctx: RequestGateContext): Promise<RequestGateDecision> | RequestGateDecision
  /**
   * Called for a request every gate admitted, on surfaces where completion is observable.
   * The returned callback runs once when the request finishes (success or failure).
   */
  onAdmitted?(ctx: RequestGateContext): RequestGateRelease | void
}

export type RequestAdmission =
  | { admitted: false; response: Response }
  | { admitted: true; release: RequestGateRelease }

const REQUEST_GATES_KEY = '__openMercatoRequestGates__'

type RequestGateGlobalScope = typeof globalThis & {
  [REQUEST_GATES_KEY]?: RequestGate[]
}

const logger = createLogger('runtime').child({ component: 'request-gate' })

function gateStore(): RequestGate[] {
  const scope = globalThis as RequestGateGlobalScope
  if (!scope[REQUEST_GATES_KEY]) scope[REQUEST_GATES_KEY] = []
  return scope[REQUEST_GATES_KEY]!
}

function sortGates(gates: RequestGate[]): RequestGate[] {
  return [...gates].sort((left, right) => (right.priority ?? 0) - (left.priority ?? 0))
}

export function registerRequestGate(gate: RequestGate): void {
  const store = gateStore()
  const existingIndex = store.findIndex((entry) => entry.id === gate.id)
  if (existingIndex >= 0) store.splice(existingIndex, 1, gate)
  else store.push(gate)
}

export function unregisterRequestGate(id: string): void {
  const store = gateStore()
  const existingIndex = store.findIndex((entry) => entry.id === id)
  if (existingIndex >= 0) store.splice(existingIndex, 1)
}

export function hasRequestGates(): boolean {
  return gateStore().length > 0
}

export function listRequestGates(): RequestGate[] {
  return sortGates(gateStore())
}

export async function evaluateRequestGates(ctx: RequestGateContext): Promise<Response | null> {
  const store = gateStore()
  if (store.length === 0) return null
  for (const gate of sortGates(store)) {
    try {
      const decision = await gate.evaluate(ctx)
      if (decision && decision.response) return decision.response
    } catch (error) {
      logger.error('Request gate threw; skipping it', { gateId: gate.id, err: error })
    }
  }
  return null
}

const noopRelease: RequestGateRelease = () => {}

/**
 * Evaluates every gate and, when the request is admitted, starts in-flight accounting.
 * Call the returned `release` exactly once when the request completes.
 */
export async function admitRequest(ctx: RequestGateContext): Promise<RequestAdmission> {
  const store = gateStore()
  if (store.length === 0) return { admitted: true, release: noopRelease }
  const blocked = await evaluateRequestGates(ctx)
  if (blocked) return { admitted: false, response: blocked }
  const releases: RequestGateRelease[] = []
  for (const gate of sortGates(store)) {
    if (typeof gate.onAdmitted !== 'function') continue
    try {
      const release = gate.onAdmitted(ctx)
      if (typeof release === 'function') releases.push(release)
    } catch (error) {
      logger.error('Request gate admission hook threw; skipping it', { gateId: gate.id, err: error })
    }
  }
  if (releases.length === 0) return { admitted: true, release: noopRelease }
  let released = false
  return {
    admitted: true,
    release: () => {
      if (released) return
      released = true
      for (const release of releases) {
        try {
          release()
        } catch (error) {
          logger.error('Request gate release threw', { err: error })
        }
      }
    },
  }
}

export function createCookieReader(cookieHeader: string | null | undefined): RequestGateCookies {
  const parsed = new Map<string, string>()
  if (cookieHeader) {
    for (const part of cookieHeader.split(';')) {
      const separator = part.indexOf('=')
      if (separator <= 0) continue
      const name = part.slice(0, separator).trim()
      if (!name || parsed.has(name)) continue
      const rawValue = part.slice(separator + 1).trim()
      try {
        parsed.set(name, decodeURIComponent(rawValue))
      } catch {
        parsed.set(name, rawValue)
      }
    }
  }
  return { get: (name: string) => parsed.get(name) }
}
