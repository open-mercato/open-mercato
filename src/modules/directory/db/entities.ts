import { Entity, PrimaryKey, Property, ManyToOne, OneToMany, Collection } from '@mikro-orm/core'

@Entity({ tableName: 'tenants' })
export class Tenant {
  @PrimaryKey({ type: 'int' })
  id!: number

  @Property({ type: 'text' })
  name!: string

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @OneToMany(() => Organization, (o) => o.tenant)
  organizations = new Collection<Organization>(this)
}

@Entity({ tableName: 'organizations' })
export class Organization {
  @PrimaryKey({ type: 'int' })
  id!: number

  @ManyToOne(() => Tenant)
  tenant!: Tenant

  @Property({ type: 'text' })
  name!: string

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}
