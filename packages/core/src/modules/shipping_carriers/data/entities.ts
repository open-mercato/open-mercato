import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core'

@Entity({ tableName: 'carrier_shipments' })
@Index({ properties: ['orderId', 'organizationId', 'tenantId'] })
@Index({ properties: ['providerKey', 'carrierShipmentId', 'organizationId'] })
@Index({ properties: ['organizationId', 'tenantId', 'unifiedStatus'] })
export class CarrierShipment {
  [OptionalProps]?: 'labelUrl' | 'labelData' | 'trackingEvents' | 'carrierStatus' | 'lastWebhookAt' | 'lastPolledAt' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'order_id', type: 'uuid' })
  orderId!: string

  @Property({ name: 'provider_key', type: 'text' })
  providerKey!: string

  @Property({ name: 'carrier_shipment_id', type: 'text' })
  carrierShipmentId!: string

  @Property({ name: 'tracking_number', type: 'text' })
  trackingNumber!: string

  @Property({ name: 'unified_status', type: 'text' })
  unifiedStatus: string = 'label_created'

  @Property({ name: 'carrier_status', type: 'text', nullable: true })
  carrierStatus?: string | null

  @Property({ name: 'label_url', type: 'text', nullable: true })
  labelUrl?: string | null

  @Property({ name: 'label_data', type: 'text', nullable: true })
  labelData?: string | null

  @Property({ name: 'tracking_events', type: 'jsonb', nullable: true })
  trackingEvents?: Array<{ status: string; occurredAt: string; location?: string }> | null

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'last_webhook_at', type: Date, nullable: true })
  lastWebhookAt?: Date | null

  @Property({ name: 'last_polled_at', type: Date, nullable: true })
  lastPolledAt?: Date | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}
