export const BOOTSTRAP_REGISTRATIONS_FAILED_KEY = '__openMercatoBootstrapRegistrationsFailed__'

export function markBootstrapRegistrationsFailed(): void {
  ;(globalThis as Record<string, unknown>)[BOOTSTRAP_REGISTRATIONS_FAILED_KEY] = true
}

/**
 * True when a CLI, worker or MCP process could not load its generated bootstrap
 * registrations, so a registry filled by them may be incomplete. Registries that
 * protect data treat this as invalid instead of as an empty registry.
 */
export function didBootstrapRegistrationsFail(): boolean {
  return (globalThis as Record<string, unknown>)[BOOTSTRAP_REGISTRATIONS_FAILED_KEY] === true
}
