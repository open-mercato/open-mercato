/**
 * Shim for #generated/entities.ids.generated
 *
 * Re-exports the actual E and M values from the generated file.
 * This ensures route configurations get static entity IDs at module load time,
 * which is required for the QueryEngine path to work correctly.
 */
export { E, M } from '../../generated/entities.ids.generated'
export type { KnownModuleId, KnownEntities } from '../../generated/entities.ids.generated'
