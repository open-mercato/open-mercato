import { defaultEncryptionMaps } from '../encryption'
import { AssistedSellingMessage, AssistedSellingParticipant, AssistedSellingProposal } from '../data/entities'

// Step 4.4 (§5.7). Regression guard for the exact defect this Step's own `encryption.ts`
// header comment documents: §5.7's literal spec strings (`assisted_selling:message`, etc.)
// do NOT match what `packages/cli/src/lib/generators/entity-ids.ts#toSnake(className)`
// actually produces for this module's full-class-name-prefixed entities
// (`AssistedSellingMessage` -> `assisted_selling_message`, not `message`). A map keyed on
// the wrong id resolves nothing through `resolveEntityIdFromMetadata`, so every field below
// would silently round-trip in PLAINTEXT. This test fails loudly if that regresses.

function toSnake(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[\s-]+/g, '_')
    .replace(/__+/g, '_')
    .toLowerCase()
}

describe('assisted_selling encryption map entity ids (§5.7)', () => {
  test('entityId matches the generator\'s actual <module>:<ClassName-snake-cased> convention', () => {
    const expected = new Map<Function, string>([
      [AssistedSellingMessage, `assisted_selling:${toSnake('AssistedSellingMessage')}`],
      [AssistedSellingParticipant, `assisted_selling:${toSnake('AssistedSellingParticipant')}`],
      [AssistedSellingProposal, `assisted_selling:${toSnake('AssistedSellingProposal')}`],
    ])
    const classByEntityId = new Map<string, Function>([
      [defaultEncryptionMaps[0].entityId, AssistedSellingMessage],
      [defaultEncryptionMaps[1].entityId, AssistedSellingParticipant],
      [defaultEncryptionMaps[2].entityId, AssistedSellingProposal],
    ])

    for (const [entityId, cls] of classByEntityId) {
      expect(entityId).toBe(expected.get(cls))
    }

    // Confirmed against the real, already-generated registry at the time of writing:
    // `packages/core/generated/entities.ids.generated.ts` resolves this module's
    // `AssistedSellingStoreSettings` to `assisted_selling:assisted_selling_store_settings`
    // (full class name, snake-cased) — not `assisted_selling:store_settings` — the same
    // convention this test asserts for message/participant/proposal.
    expect(toSnake('AssistedSellingStoreSettings')).toBe('assisted_selling_store_settings')
  })

  test('declares exactly the three fields §5.7 names, nothing more', () => {
    expect(defaultEncryptionMaps).toHaveLength(3)
    expect(defaultEncryptionMaps[0].fields).toEqual([{ field: 'body' }])
    expect(defaultEncryptionMaps[1].fields).toEqual([{ field: 'displayName' }])
    expect(defaultEncryptionMaps[2].fields).toEqual([{ field: 'rejectionReason' }])
  })
})
