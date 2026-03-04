import { Entity, PrimaryKey, Property, Index, Unique } from '@mikro-orm/core'

@Entity({ tableName: 'carrier_shipments' })
@Index({ properties: ['providerKey', 'tenantId', 'organizationId'] })
@Index({ properties: ['orderId', 'tenantId', 'organizationId'] })
@Unique({ properties: ['providerKey', 'carrierShipmentId', 'tenantId', 'organizationId'] })
export class CarrierShipment {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'provider_key', type: 'text' })
  providerKey!: string

  @Property({ name: 'order_id', type: 'uuid', nullable: true })
  orderId?: string | null

  @Property({ name: 'carrier_shipment_id', type: 'text' })
  carrierShipmentId!: string

  @Property({ name: 'tracking_number', type: 'text', nullable: true })
  trackingNumber?: string | null

  @Property({ name: 'status', type: 'text', nullable: true })
  status?: string | null

  @Property({ name: 'label_url', type: 'text', nullable: true })
  labelUrl?: string | null

  @Property({ name: 'carrier_data', type: 'jsonb', nullable: true })
  carrierData?: Record<string, unknown> | null

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}
