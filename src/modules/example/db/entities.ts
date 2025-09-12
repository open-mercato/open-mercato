import { Entity, PrimaryKey, Property } from '@mikro-orm/core'

@Entity({ tableName: 'example_items' })
export class ExampleItem {
  @PrimaryKey()
  id!: number

  @Property()
  title!: string

  @Property({ name: 'created_at', onCreate: () => new Date() })
  createdAt: Date = new Date()
}

