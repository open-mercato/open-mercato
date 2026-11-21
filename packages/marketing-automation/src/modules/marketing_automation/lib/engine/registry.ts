import type { ZodType } from 'zod'
import type { AutomationContext, EngineLogger } from './types.js'

/** How a step's parameter is edited in the canvas inspector. */
export type UiFieldSpec = {
  name: string
  kind: 'text' | 'textarea' | 'number' | 'select' | 'customer_tag' | 'boolean'
  labelKey: string
  required?: boolean
  options?: { value: string; labelKey: string }[]
}

export type StepResult = {
  status: 'done' | 'skipped'
  /** Short, translatable-free detail for the run log — not user-facing copy. */
  detail?: string
  /** Merged into the context before the next step runs. */
  contextPatch?: Record<string, unknown>
}

/**
 * A step type.
 *
 * The UI metadata lives on the handler rather than in a parallel table so a step contributed
 * by another module appears in the palette with a working inspector form and server-side
 * validation without any UI code of its own.
 */
export type StepHandler<TDeps = unknown> = {
  type: string
  labelKey: string
  descriptionKey?: string
  icon?: string
  paramsSchema: ZodType
  uiFields: UiFieldSpec[]
  /**
   * Set when the step sends an outbound message. Drives the frequency cap and quiet hours,
   * and is what gets recorded in the send history — a step that does not declare a channel is
   * never rate-limited, which is correct for `add_tag` and wrong for anything that messages
   * somebody.
   */
  channel?: 'email' | 'sms' | 'push'
  execute(ctx: AutomationContext, params: Record<string, unknown>, deps: TDeps): Promise<StepResult>
}

const stepHandlers = new Map<string, StepHandler<never>>()

/**
 * Registers step types, last-one-wins.
 *
 * Called at module-DI load time, following the same cross-module registration precedent the
 * platform already uses for workflow-safe commands and optimistic-lock readers.
 */
export function registerMarketingSteps(handlers: StepHandler<never>[], logger?: EngineLogger): void {
  for (const handler of handlers) {
    if (stepHandlers.has(handler.type)) {
      logger?.warn('[internal] marketing step type re-registered', { type: handler.type })
    }
    stepHandlers.set(handler.type, handler)
  }
}

export function getMarketingStep(type: string): StepHandler<never> | undefined {
  return stepHandlers.get(type)
}

export function listMarketingSteps(): StepHandler<never>[] {
  return [...stepHandlers.values()]
}

export function __resetMarketingStepsForTests(): void {
  stepHandlers.clear()
}
