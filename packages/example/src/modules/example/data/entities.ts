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

// Demo Todo entity used by the example module's backend page
@Entity({ tableName: 'todos' })
export class Todo {
  @PrimaryKey({ type: 'int' })
  id!: number

  @Property({ type: 'text' })
  title!: string

  @Property({ name: 'tenant_id', type: 'int', nullable: true })
  tenantId?: number | null

  @Property({ name: 'organization_id', type: 'int', nullable: true })
  organizationId?: number | null

  @Property({ name: 'is_done', type: 'boolean', default: false })
  isDone: boolean = false

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}
