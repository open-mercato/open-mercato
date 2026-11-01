import type { ModuleEncryptionMap } from '@open-mercato/shared/modules/encryption'

// Step 4.4 (§5.7). All reads go through `findWithDecryption`/`findOneWithDecryption`. The
// thread holds no cart token in any form (§5.1), so there is nothing token-shaped to map.
// The authoring `note` needs no map entry of its own — it is stored only as the body of the
// proposal's message (§6.3 step 7, S19); the proposal cart's own `note` stays empty.
//
// `entityId` deviates from §5.7's literal `assisted_selling:message`/`:participant`/
// `:proposal` strings. `packages/cli/src/lib/generators/entity-ids.ts#toSnake(className)`
// derives the generated id from the FULL entity class name — confirmed against the already-
// generated `packages/core/generated/entities.ids.generated.ts`, where this module's own
// `AssistedSellingStoreSettings` resolves to `assisted_selling:assisted_selling_store_
// settings`, not `assisted_selling:store_settings`. Since this module's entity classes all
// carry the `AssistedSelling` prefix (`AssistedSellingMessage`, not `Message`), the real,
// generator-produced ids are `assisted_selling:assisted_selling_message` etc. — the literal
// spec strings would silently map nothing (`resolveEntityIdFromMetadata` would never find
// them), leaving every field below unencrypted. Using the real ids here is the only way
// `findWithDecryption`/`findOneWithDecryption` ever resolve this module's own encryption map.
export const defaultEncryptionMaps: ModuleEncryptionMap[] = [
  {
    entityId: 'assisted_selling:assisted_selling_message',
    fields: [{ field: 'body' }],
  },
  {
    entityId: 'assisted_selling:assisted_selling_participant',
    fields: [{ field: 'displayName' }],
  },
  {
    entityId: 'assisted_selling:assisted_selling_proposal',
    fields: [{ field: 'rejectionReason' }],
  },
]

export default defaultEncryptionMaps
