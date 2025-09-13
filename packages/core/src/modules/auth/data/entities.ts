import { Entity, PrimaryKey, Property, ManyToOne, Unique } from '@mikro-orm/core'
import { Tenant, Organization } from '@mercato-core/modules/directory/data/entities'

@Entity({ tableName: 'users' })
export class User {
  @PrimaryKey({ type: 'int' })
  id!: number

  @ManyToOne(() => Tenant)
  tenant!: Tenant

  @ManyToOne(() => Organization)
  organization!: Organization

  @Property({ type: 'text', unique: true })
  email!: string

  @Property({ type: 'text', nullable: true })
  name?: string

  @Property({ name: 'password_hash', type: 'text', nullable: true })
  passwordHash?: string | null

  @Property({ name: 'is_confirmed', type: 'boolean', default: true })
  isConfirmed: boolean = true

  @Property({ name: 'last_login_at', type: Date, nullable: true })
  lastLoginAt?: Date

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}

@Entity({ tableName: 'roles' })
export class Role {
  @PrimaryKey({ type: 'int' })
  id!: number

  @Property({ type: 'text', unique: true })
  name!: string

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}

@Entity({ tableName: 'user_roles' })
export class UserRole {
  @PrimaryKey({ type: 'int' })
  id!: number

  @ManyToOne(() => User)
  user!: User

  @ManyToOne(() => Role)
  role!: Role

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}

@Entity({ tableName: 'sessions' })
export class Session {
  @PrimaryKey({ type: 'int' })
  id!: number

  @ManyToOne(() => User)
  user!: User

  @Property({ type: 'text', unique: true })
  token!: string

  @Property({ name: 'expires_at', type: Date })
  expiresAt!: Date

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'last_used_at', type: Date, nullable: true })
  lastUsedAt?: Date
}

@Entity({ tableName: 'password_resets' })
export class PasswordReset {
  @PrimaryKey({ type: 'int' })
  id!: number

  @ManyToOne(() => User)
  user!: User

  @Property({ type: 'text', unique: true })
  token!: string

  @Property({ name: 'expires_at', type: Date })
  expiresAt!: Date

  @Property({ name: 'used_at', type: Date, nullable: true })
  usedAt?: Date

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}
