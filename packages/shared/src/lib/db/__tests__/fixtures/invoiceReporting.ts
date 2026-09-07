import { Entity, PrimaryKey } from '@mikro-orm/decorators/legacy'

@Entity({ tableName: 'duplicate_entity_fixture_reporting' })
export class Invoice {
  @PrimaryKey({ type: 'string' })
  id!: string
}
