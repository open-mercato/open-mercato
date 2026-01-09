import {
  Collection,
  Entity,
  Index,
  ManyToOne,
  OneToMany,
  OptionalProps,
  PrimaryKey,
  Property,
  Unique,
} from '@mikro-orm/core'
import type { Quadrant } from './types.js'

@Entity({
  tableName: 'fms_locations',
  discriminatorColumn: 'product_type',
  abstract: true,
})
@Index({
  name: 'fms_locations_scope_idx',
  properties: ['organizationId', 'tenantId'],
})
@Unique({
  name: 'fms_locations_unique',
  properties: ['organizationId', 'tenantId', 'code'],
})
export abstract class FmsLocation {
  [OptionalProps]?: 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ type: 'text' })
  code!: string

  @Property({ type: 'text' })
  name!: string

  @Property({ type: 'text' })
  quadrant!: Quadrant

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy?: string | null

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'updated_by', type: 'uuid', nullable: true })
  updatedBy?: string | null

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ discriminatorValue: 'port' })
export class FmsPort extends FmsLocation {
  @Property({ type: 'text' })
  locode!: string

  @OneToMany(()=> FmsTerminal, (terminal) => terminal.port)
  terminals = new Collection<FmsTerminal>(this)
}

@Entity({ discriminatorValue: 'terminal' })
export class FmsTerminal extends FmsLocation {

  @ManyToOne(() => FmsPort, {
    fieldName: 'port_id',
    nullable: false,
    deleteRule: 'restrict',
  })
  port!: FmsPort
}