/**
 * Shim for #generated/entity-fields-registry
 *
 * This allows packages to continue using `import { getEntityFields } from '#generated/entity-fields-registry'`
 * while actually getting the entity fields from the registration pattern.
 *
 * The actual entity fields are registered at bootstrap time via registerEntityFields().
 * During module load (before bootstrap), accessing fields will return undefined values.
 * This is safe because the actual values are only used at runtime, not at module load time.
 */
export {
  getEntityFields,
  getEntityFieldsRegistry as entityFieldsRegistry,
  type EntityFieldsRegistry,
} from '@open-mercato/shared/lib/encryption/entityFields'
