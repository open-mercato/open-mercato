import { Entity, PrimaryKey, Property, ManyToOne, OneToMany, Collection } from '@mikro-orm/core'

@Entity({ tableName: 'tenants' })
export class Tenant {
  @PrimaryKey()
  id!: number

  @Property()
  name!: string

  @Property({ name: 'is_active', default: true })
  isActive: boolean = true

  @Property({ name: 'created_at', onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @OneToMany(() => Organization, (o) => o.tenant)
  organizations = new Collection<Organization>(this)
}

@Entity({ tableName: 'organizations' })
export class Organization {
  @PrimaryKey()
  id!: number

  @ManyToOne(() => Tenant)
  tenant!: Tenant

  @Property()
  name!: string

  @Property({ name: 'is_active', default: true })
  isActive: boolean = true

  @Property({ name: 'created_at', onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

