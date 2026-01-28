import { Entity, PrimaryKey, Property, Unique } from '@mikro-orm/core'

@Entity({ tableName: 'api_keys' })
@Unique({ properties: ['keyPrefix'] })
export class ApiKey {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ type: 'text' })
  name!: string

  @Property({ name: 'description', type: 'text', nullable: true })
  description?: string | null

  @Property({ name: 'tenant_id', type: 'uuid', nullable: true })
  tenantId?: string | null

  @Property({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId?: string | null

  @Property({ name: 'key_hash', type: 'text' })
  keyHash!: string

  @Property({ name: 'key_prefix', type: 'text' })
  keyPrefix!: string

  @Property({ name: 'roles_json', type: 'json', nullable: true })
  rolesJson?: string[] | null

  @Property({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy?: string | null

  /** Session token for ephemeral session-scoped keys (used by AI chat) */
  @Property({ name: 'session_token', type: 'text', nullable: true })
  sessionToken?: string | null

  /** User ID who owns this session (for ephemeral keys) */
  @Property({ name: 'session_user_id', type: 'uuid', nullable: true })
  sessionUserId?: string | null

  /** Encrypted API key secret for session keys (recoverable for API calls) */
  @Property({ name: 'session_secret_encrypted', type: 'text', nullable: true })
  sessionSecretEncrypted?: string | null

  @Property({ name: 'last_used_at', type: Date, nullable: true })
  lastUsedAt?: Date | null

  @Property({ name: 'expires_at', type: Date, nullable: true })
  expiresAt?: Date | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date(), nullable: true })
  updatedAt?: Date

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}
