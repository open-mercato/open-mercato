import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { bootstrap } from '@open-mercato/core/bootstrap'
import { applicationLifecycleEvents } from '@open-mercato/shared/lib/runtime/events'

const APP_BOOTSTRAP_STARTED_EMITTED_KEY = '__openMercatoApplicationBootstrapStartedEventEmitted__'
const APP_BOOTSTRAP_COMPLETED_EMITTED_KEY = '__openMercatoApplicationBootstrapCompletedEventEmitted__'
const APP_BOOTSTRAP_FAILED_EMITTED_KEY = '__openMercatoApplicationBootstrapFailedEventEmitted__'

async function emitApplicationLifecycleEvent(
  container: AppContainer,
  eventName: string,
  emittedKey: string,
  payload: Record<string, unknown>
) {
  if ((globalThis as Record<string, unknown>)[emittedKey] === true) return

  try {
    const eventBus = container.resolve('eventBus') as {
      emit?: (event: string, payload: unknown) => Promise<void>
      emitEvent?: (event: string, payload: unknown) => Promise<void>
    }

    if (typeof eventBus.emit === 'function') {
      await eventBus.emit(eventName, payload)
    } else if (typeof eventBus.emitEvent === 'function') {
      await eventBus.emitEvent(eventName, payload)
    } else {
      return
    }

    ;(globalThis as Record<string, unknown>)[emittedKey] = true
  } catch (error) {
    console.warn('[application] Failed to emit lifecycle event', {
      event: eventName,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

// App-level DI overrides/registrations.
// This runs after core defaults and module DI registrars.
export async function register(container: AppContainer) {
  const basePayload = {
    source: 'apps/mercato',
    emittedAt: new Date().toISOString(),
  }

  await emitApplicationLifecycleEvent(
    container,
    applicationLifecycleEvents.bootstrapStarted,
    APP_BOOTSTRAP_STARTED_EMITTED_KEY,
    basePayload
  )

  try {
    // Call core bootstrap to setup eventBus and auto-register subscribers.
    // Guard against duplicate bootstrap when core bootstrap already ran in createRequestContainer.
    // Check the resolved value (not just registration existence) because container.ts
    // pre-registers eventBus as null for Awilix CLASSIC mode compatibility.
    const existingBus = (() => { try { return container.resolve('eventBus') } catch { return null } })()
    if (!existingBus) {
      await bootstrap(container)
    }
  } catch (error) {
    await emitApplicationLifecycleEvent(
      container,
      applicationLifecycleEvents.bootstrapFailed,
      APP_BOOTSTRAP_FAILED_EMITTED_KEY,
      {
        ...basePayload,
        errorMessage: error instanceof Error ? error.message : String(error),
      }
    )
    throw error
  }

  await emitApplicationLifecycleEvent(
    container,
    applicationLifecycleEvents.bootstrapCompleted,
    APP_BOOTSTRAP_COMPLETED_EMITTED_KEY,
    basePayload
  )
  // App-level overrides can follow here
}
