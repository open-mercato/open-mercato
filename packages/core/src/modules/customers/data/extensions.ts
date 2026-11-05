import type { EntityExtension } from '@open-mercato/shared/modules/entities'

/**
 * Cross-module entity links declared by the customers module.
 *
 * Per root AGENTS.md, modules do NOT form direct ORM relationships across
 * boundaries. Instead, plain UUID columns reference IDs in other modules and
 * the link is declared here so the data engine + UI tooling can traverse.
 *
 * Canonical EntityExtension shape from `@open-mercato/shared/modules/entities`:
 *   `{ base, extension, join: { baseKey, extensionKey }, cardinality?, required?, description? }`
 */

const entityExtensions: EntityExtension[] = [
  {
    base: 'customers:customer_interaction',
    extension: 'communication_channels:message_channel_link',
    join: { baseKey: 'external_message_id', extensionKey: 'id' },
    cardinality: 'many-to-one',
    description:
      'Links an email CustomerInteraction to the MessageChannelLink that tracks its external channel metadata',
  },
]

export const extensions = entityExtensions
export default entityExtensions
