import { MetadataStorage } from '@mikro-orm/core'
import { defaultEncryptionMaps } from '../encryption'
import * as agentOrchestratorEntities from '../data/entities'

/**
 * `defaultEncryptionMaps` keys every entry by a PLAIN STRING `entityId` and a
 * plain string column name. Nothing in the type system connects either to the
 * ORM entity it names, so an entity or column rename that forgets the map fails
 * SILENTLY and in green CI: the affected columns start persisting in plaintext
 * while every previously-encrypted row becomes undecryptable.
 *
 * That is exactly what the `agent_task_*` → `agent_process_*` rename could have
 * done to `input`, `input_defaults` and `failure_reason` — all PII-bearing. This
 * guard closes the hole for the NEXT rename.
 */

const MODULE_ID = 'agent_orchestrator'

/** Mirrors `toSnake` in `packages/cli/src/lib/utils.ts`, which derives every entity id. */
function toSnake(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/\W+/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/(?:^_+|_+$)/g, '')
    .toLowerCase()
}

type EntityMetadataLike = {
  className?: string
  properties?: Record<string, { name?: string; fieldName?: string }>
}

/**
 * entityId → the set of database column names the ORM declares for it. The
 * decorator only records `fieldName` when the column name differs from the
 * property name, so an unset one falls back to the underscore naming strategy.
 */
function collectRegisteredEntities(): Map<string, Set<string>> {
  // Importing the module runs its @Entity decorators, which populate the storage.
  void agentOrchestratorEntities
  const registered = new Map<string, Set<string>>()
  for (const meta of Object.values(MetadataStorage.getMetadata()) as EntityMetadataLike[]) {
    if (!meta.className) continue
    const columns = new Set<string>()
    for (const [propertyName, property] of Object.entries(meta.properties ?? {})) {
      columns.add(property.fieldName ?? toSnake(property.name ?? propertyName))
    }
    registered.set(`${MODULE_ID}:${toSnake(meta.className)}`, columns)
  }
  return registered
}

describe('agent_orchestrator encryption maps', () => {
  const registered = collectRegisteredEntities()

  it('declares at least the entities this module is known to encrypt', () => {
    expect(registered.has('agent_orchestrator:agent_process_definition')).toBe(true)
    expect(registered.has('agent_orchestrator:agent_process_run')).toBe(true)
    expect(defaultEncryptionMaps.length).toBeGreaterThan(0)
  })

  it.each(defaultEncryptionMaps.map((map) => [map.entityId, map] as const))(
    'resolves %s to a registered entity',
    (entityId, map) => {
      const columns = registered.get(entityId)
      expect(columns).toBeDefined()
      const unknownFields = map.fields
        .map((field) => (typeof field === 'string' ? field : field.field))
        .filter((field) => !columns?.has(field))
      expect(unknownFields).toEqual([])
    },
  )

  it('keeps the renamed process entities encrypted on exactly the PII columns', () => {
    const byEntityId = new Map(defaultEncryptionMaps.map((map) => [map.entityId, map]))
    const fieldsOf = (entityId: string) =>
      (byEntityId.get(entityId)?.fields ?? []).map((field) =>
        typeof field === 'string' ? field : field.field,
      )

    expect(fieldsOf('agent_orchestrator:agent_process_definition')).toEqual(['input_defaults'])
    expect(fieldsOf('agent_orchestrator:agent_process_run')).toEqual(['input', 'failure_reason'])
    expect(byEntityId.has('agent_orchestrator:agent_task_definition')).toBe(false)
    expect(byEntityId.has('agent_orchestrator:agent_task_run')).toBe(false)
  })
})
