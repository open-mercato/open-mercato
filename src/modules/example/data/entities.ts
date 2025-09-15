import { Entity, PrimaryKey, Property } from '@mikro-orm/core'

// Copied from package module to keep compatibility when overriding entities at app level
@Entity({ tableName: 'example_items' })
export class ExampleItem {
  @PrimaryKey({ type: 'int' })
  id!: number

  @Property({ type: 'text' })
  title!: string

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}

// New demo entity for the Todo list example
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
