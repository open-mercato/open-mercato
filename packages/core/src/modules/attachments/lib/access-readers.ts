import { tryGetModules } from '@open-mercato/shared/lib/modules/registry'
import { getAttachmentAccessRegistry } from './access-registry'

/**
 * Modules known to read attachment rows by caller-supplied id outside
 * `evaluateAttachmentRowAccess`. Ids only: nothing is imported from them.
 */
export const KNOWN_DIRECT_ATTACHMENT_READER_MODULES: readonly string[] = Object.freeze(['agent_orchestrator'])

/**
 * Enabled modules from `KNOWN_DIRECT_ATTACHMENT_READER_MODULES` that have not declared
 * `enforcesOwnerAccessOnDirectReads` in their `data/attachment-access.ts`. Owner modules
 * call it before storing files that must not reach such a reader. Unregistered modules
 * or an invalid access registry report every listed module (fail closed).
 */
export function listUnguardedAttachmentReaders(): string[] {
  const registry = getAttachmentAccessRegistry()
  const modules = tryGetModules()
  if (!modules || registry.invalid) return [...KNOWN_DIRECT_ATTACHMENT_READER_MODULES]
  const enabled = new Set(modules.map((module) => module.id))
  const declared = new Set(registry.ownerAccessEnforcingModules)
  return KNOWN_DIRECT_ATTACHMENT_READER_MODULES.filter((moduleId) => enabled.has(moduleId) && !declared.has(moduleId))
}
