import { Entity, PrimaryKey } from '@mikro-orm/decorators/legacy'

@Entity({ tableName: 'duplicate_entity_fixture_ledger_subscriptions' })
export class Ledger {
  @PrimaryKey({ type: 'string' })
  id!: string
}
