/**
 * Workflow engine version — the forward-compatibility guard for additive
 * definition capabilities (spec 2026-07-26-workflows-ux-redesign.md section
 * 5.8).
 *
 * A definition may declare `metadata.minEngineVersion`. An engine whose
 * `WORKFLOW_ENGINE_VERSION` is lower refuses to instantiate that definition
 * rather than silently misexecuting a capability it does not know. Bump the
 * constant whenever a release teaches the engine a new definition capability,
 * and have the editor stamp the matching `minEngineVersion` on definitions
 * that use it.
 *
 * Version log:
 * - 1: baseline (all step types up to and including WAIT_FOR_TIMER)
 * - 2: IF_ELSE and SWITCH branching steps
 * - 3: WAIT_FOR_CONDITION predicate wait step
 * - 4: outcome transitions for agent disposition routing
 */
export const WORKFLOW_ENGINE_VERSION = 4

/**
 * Engine versions required by definition capabilities. Kept pure and data-only
 * so both the editor (stamping metadata on save) and the engine can share them.
 */
export const STEP_TYPE_MIN_ENGINE_VERSIONS: Record<string, number> = {
  IF_ELSE: 2,
  SWITCH: 2,
  WAIT_FOR_CONDITION: 3,
}

export const TRANSITION_KIND_MIN_ENGINE_VERSIONS: Record<string, number> = {
  outcome: 4,
}

export type EngineVersionedDefinition = {
  steps?: unknown
  transitions?: unknown
}

export function resolveRequiredEngineVersion(definition: EngineVersionedDefinition | null | undefined): number {
  if (!definition || typeof definition !== 'object') return 1
  let required = 1
  if (Array.isArray(definition.steps)) {
    for (const step of definition.steps) {
      const stepType = step && typeof step === 'object' ? (step as { stepType?: unknown }).stepType : undefined
      if (typeof stepType !== 'string') continue
      const version = STEP_TYPE_MIN_ENGINE_VERSIONS[stepType]
      if (version && version > required) required = version
    }
  }
  if (Array.isArray(definition.transitions)) {
    for (const transition of definition.transitions) {
      const transitionKind = transition && typeof transition === 'object'
        ? (transition as { kind?: unknown }).kind
        : undefined
      if (typeof transitionKind !== 'string') continue
      const version = TRANSITION_KIND_MIN_ENGINE_VERSIONS[transitionKind]
      if (version && version > required) required = version
    }
  }
  return required
}

export function isEngineVersionSupported(minEngineVersion: unknown): boolean {
  if (typeof minEngineVersion !== 'number' || !Number.isFinite(minEngineVersion)) return true
  return minEngineVersion <= WORKFLOW_ENGINE_VERSION
}
