import { Entity, PrimaryKey, Property, ManyToOne, Unique } from '@mikro-orm/core'
import { Tenant, Organization } from '@/modules/directory/db/entities'

@Entity({ tableName: 'users' })
export class User {
  @PrimaryKey()
  id!: number

  @ManyToOne(() => Tenant)
  tenant!: Tenant

  @ManyToOne(() => Organization)
  organization!: Organization

  @Property({ unique: true })
  email!: string

  @Property({ nullable: true })
  name?: string

  @Property({ name: 'password_hash', nullable: true })
  passwordHash?: string | null

  @Property({ name: 'is_confirmed', default: false })
  isConfirmed: boolean = false

  @Property({ name: 'last_login_at', nullable: true })
  lastLoginAt?: Date

  @Property({ name: 'created_at', onCreate: () => new Date() })
  createdAt: Date = new Date()
}

@Entity({ tableName: 'roles' })
export class Role {
  @PrimaryKey()
  id!: number

  @Property({ unique: true })
  name!: string

  @Property({ name: 'created_at', onCreate: () => new Date() })
  createdAt: Date = new Date()
}

@Entity({ tableName: 'user_roles' })
export class UserRole {
  @PrimaryKey()
  id!: number

  @ManyToOne(() => User)
  user!: User

  @ManyToOne(() => Role)
  role!: Role

  @Property({ name: 'created_at', onCreate: () => new Date() })
  createdAt: Date = new Date()
}

@Entity({ tableName: 'sessions' })
export class Session {
  @PrimaryKey()
  id!: number

  @ManyToOne(() => User)
  user!: User

  @Property({ unique: true })
  token!: string

  @Property({ name: 'expires_at' })
  expiresAt!: Date

  @Property({ name: 'created_at', onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'last_used_at', nullable: true })
  lastUsedAt?: Date
}

@Entity({ tableName: 'password_resets' })
export class PasswordReset {
  @PrimaryKey()
  id!: number

  @ManyToOne(() => User)
  user!: User

  @Property({ unique: true })
  token!: string

  @Property({ name: 'expires_at' })
  expiresAt!: Date

  @Property({ name: 'used_at', nullable: true })
  usedAt?: Date

  @Property({ name: 'created_at', onCreate: () => new Date() })
  createdAt: Date = new Date()
}

