import type { DatabaseModuleDeclarations } from '@open-mercato/shared/lib/db/declarations'

export const databaseDeclarations: DatabaseModuleDeclarations = {
  tables: [{ table: 'customer_entities', classification: 'enforced', reason: 'Initial reviewed customer CRUD canary.' }],
}
