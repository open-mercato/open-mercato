import {
  Entity,
  Index,
  OptionalProps,
  PrimaryKey,
  Property,
} from '@mikro-orm/core'
import type { LocationType } from './types'

@Entity({ tableName: 'fms_locations' })
@Index({
  name: 'fms_locations_scope_idx',
  properties: ['organizationId', 'tenantId'],
})
@Index({
  name: 'fms_locations_type_idx',
  properties: ['type'],
})
export class FmsLocation {
  [OptionalProps]?:
    | 'createdAt'
    | 'updatedAt'
    | 'deletedAt'
    | 'locode'
    | 'portId'
    | 'lat'
    | 'lng'
    | 'city'
    | 'country'

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

  @Property({ name: 'product_type', type: 'text' })
  type!: LocationType

  @Property({ type: 'text', nullable: true })
  locode?: string | null

  @Property({ name: 'port_id', type: 'uuid', nullable: true })
  portId?: string | null

  @Property({ type: 'double', nullable: true })
  lat?: number | null

  @Property({ type: 'double', nullable: true })
  lng?: number | null

  @Property({ type: 'text', nullable: true })
  city?: string | null

  @Property({ type: 'text', nullable: true })
  country?: string | null

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
