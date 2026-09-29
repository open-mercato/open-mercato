import type { TelemetryProvider } from '../types'
import { NoopProvider } from './noop-provider'

/**
 * The active provider is a PROCESS-WIDE singleton, stored on `globalThis` rather
 * than in a module variable. This is load-bearing: the worker bootstrap
 * esbuild-bundles the generated DI registry into a `.mjs` that can inline a
 * *private copy* of this module, while job handlers are dynamic-imported as
 * source and use the *source copy*. With module-level state, `initTelemetry()`
 * would set the provider on one copy while the handlers read a still-noop other
 * — so worker logs/spans would never reach the backend. Keying the state on a
 * global symbol makes every copy share one provider. Mirrors the framework's own
 * DI-registrar global.
 */
const GLOBAL_KEY = Symbol.for('@open-mercato/telemetry.providerRegistry')

type ProviderRegistry = {
  active: TelemetryProvider
  registered: Map<string, TelemetryProvider>
}

function store(): ProviderRegistry {
  const g = globalThis as unknown as Record<symbol, ProviderRegistry | undefined>
  let reg = g[GLOBAL_KEY]
  if (!reg) {
    reg = { active: new NoopProvider(), registered: new Map() }
    g[GLOBAL_KEY] = reg
  }
  return reg
}

/** Plug a custom backend before `initTelemetry()` (e.g. tests or a bespoke sink). */
export function registerProvider(provider: TelemetryProvider): void {
  store().registered.set(provider.name, provider)
}

export function getRegisteredProvider(name: string): TelemetryProvider | undefined {
  return store().registered.get(name)
}

export function getActiveProvider(): TelemetryProvider {
  return store().active
}

/** Set the active provider. Called by `initTelemetry()`. */
export function setActiveProvider(provider: TelemetryProvider): void {
  store().active = provider
}

/** Restore only the active provider while preserving custom registrations. */
export function clearActiveProvider(): void {
  store().active = new NoopProvider()
}

/** Test-only: restore the default no-op provider. */
export function resetActiveProvider(): void {
  const reg = store()
  clearActiveProvider()
  reg.registered.clear()
}
