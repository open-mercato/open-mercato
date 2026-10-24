import { Entity, Index, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy'

@Entity({ tableName: 'api_keys' })
// The unique keyPrefix bounds the bcrypt candidate loop in findApiKeyBySecret to at
// most one live row. Do not drop this constraint or widen the prefix space without
// re-evaluating that loop's per-request cost (see #3812).
@Unique({ properties: ['keyPrefix'] })
@Index({
  name: 'api_keys_opencode_session_id_uq',
  expression:
    'create unique index "api_keys_opencode_session_id_uq" on "api_keys" ("opencode_session_id") where "opencode_session_id" is not null and "deleted_at" is null',
})
@Index({
  name: 'api_keys_session_token_hash_uq',
  expression:
    'create unique index "api_keys_session_token_hash_uq" on "api_keys" ("session_token_hash") where "session_token_hash" is not null and "deleted_at" is null',
})
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

  /**
   * SHA-256 hash of the session token for ephemeral session-scoped keys (used by AI chat).
   * The raw token is a bearer credential — the same one that unlocks the decrypted API key
   * secret and the user's ACL on the MCP server — so, like `customer_accounts` session
   * tokens, only its hash is persisted. It is returned to the caller once, at issuance, and
   * never stored or logged in the clear (see #2254).
   */
  @Property({ name: 'session_token_hash', type: 'text', nullable: true })
  sessionTokenHash?: string | null

  /**
   * @deprecated Superseded by `sessionTokenHash` (#2254) — nothing reads or writes this
   * anymore and `Migration20261012202110_api_keys` nulls out every existing value as part of
   * scrubbing the plaintext token. Kept, not dropped, per the "renamed/removed DB column" rule in
   * `.ai/review-checklist.md` (keep old column, add new one, backfill, deprecate old) — chat
   * sessions in flight across the deploy carry a 2-hour TTL and only mint once per
   * conversation (`ai_assistant`'s chat route, `!sessionId` branch), so the column must survive
   * long enough for every session minted before this ships to expire naturally. Safe to drop in
   * a later migration once that window has passed.
   */
  @Property({ name: 'session_token', type: 'text', nullable: true })
  sessionToken?: string | null

  /** User ID who owns this session (for ephemeral keys) */
  @Property({ name: 'session_user_id', type: 'uuid', nullable: true })
  sessionUserId?: string | null

  /** Encrypted API key secret for session keys (recoverable for API calls) */
  @Property({ name: 'session_secret_encrypted', type: 'text', nullable: true })
  sessionSecretEncrypted?: string | null

  /**
   * OpenCode session id bound to this api_key row. Set the first time the
   * chat dispatcher receives a `done` event after minting a session token,
   * then asserted on every subsequent resume to prevent cross-user session
   * continuation (see security fix 2026-05-23).
   */
  @Property({ name: 'opencode_session_id', type: 'text', nullable: true })
  opencodeSessionId?: string | null

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
