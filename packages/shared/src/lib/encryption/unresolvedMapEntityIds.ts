import type { ModuleEncryptionMap } from '../../modules/encryption'
import { createLogger } from '../logger'
import { getEntityIds, type EntityIds } from './entityIds'

const logger = createLogger('shared').child({ component: 'encryption' })

export type UnresolvedEncryptionMapEntityId = {
  entityId: string
  suggestion: string | null
}

function editDistance(left: string, right: string): number {
  const distances = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let row = 1; row <= left.length; row++) {
    let diagonal = distances[0]
    distances[0] = row
    for (let column = 1; column <= right.length; column++) {
      const above = distances[column]
      distances[column] = Math.min(
        above + 1,
        distances[column - 1] + 1,
        diagonal + (left[row - 1] === right[column - 1] ? 0 : 1),
      )
      diagonal = above
    }
  }
  return distances[right.length]
}

function closestEntityId(entityId: string, candidates: string[]): string | null {
  const rank = (candidate: string): [number, number] => [
    candidate.startsWith(entityId) || entityId.startsWith(candidate) ? 0 : 1,
    editDistance(entityId, candidate),
  ]
  let closest: string | null = null
  let closestRank: [number, number] = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY]
  for (const candidate of candidates) {
    const candidateRank = rank(candidate)
    if (candidateRank[0] < closestRank[0] || (candidateRank[0] === closestRank[0] && candidateRank[1] < closestRank[1])) {
      closest = candidate
      closestRank = candidateRank
    }
  }
  return closest
}

/**
 * Lists encryption maps whose `entityId` names a module that registers ORM entities but matches
 * none of them. The encryption subscriber derives the entity id from the entity class, so such a
 * map is never consulted and the fields it declares are stored as plaintext.
 *
 * Ids outside an entity-registering module are left alone: `vector:vector_search`, for example,
 * is encrypted explicitly by the search module rather than through an ORM entity.
 */
export function findUnresolvedEncryptionMapEntityIds(
  maps: ReadonlyArray<Pick<ModuleEncryptionMap, 'entityId'>>,
  entityIds: EntityIds,
): UnresolvedEncryptionMapEntityId[] {
  const registered = new Set(Object.values(entityIds).flatMap((moduleEntityIds) => Object.values(moduleEntityIds ?? {})))
  const checked = new Set<string>()
  const unresolved: UnresolvedEncryptionMapEntityId[] = []
  for (const { entityId } of maps) {
    if (registered.has(entityId) || checked.has(entityId)) continue
    checked.add(entityId)
    const moduleId = entityId.split(':')[0]
    const moduleEntityIds = Object.values(entityIds[moduleId] ?? {})
    if (!moduleEntityIds.length) continue
    unresolved.push({ entityId, suggestion: closestEntityId(entityId, moduleEntityIds) })
  }
  return unresolved
}

const warnedEntityIds = new Set<string>()

/**
 * Warns about every unresolved map once per process. The core DI bootstrap that loads the maps
 * can run once per request container, so repeated calls stay quiet.
 */
export function warnUnresolvedEncryptionMapEntityIds(maps: ReadonlyArray<Pick<ModuleEncryptionMap, 'entityId'>>): void {
  for (const { entityId, suggestion } of findUnresolvedEncryptionMapEntityIds(maps, getEntityIds(false))) {
    if (warnedEntityIds.has(entityId)) continue
    warnedEntityIds.add(entityId)
    logger.warn('Encryption map entityId matches no registered entity - its fields are stored as plaintext', {
      entityId,
      suggestion,
    })
  }
}

export function resetUnresolvedEncryptionMapWarnings(): void {
  warnedEntityIds.clear()
}
