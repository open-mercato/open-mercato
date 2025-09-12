import { Entity, PrimaryKey, Property } from '@mikro-orm/core'

@Entity({ tableName: 'example_items' })
export class ExampleItem {
  @PrimaryKey({ type: 'int' })
  id!: number

  @Property({ type: 'text' })
  title!: string

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}
