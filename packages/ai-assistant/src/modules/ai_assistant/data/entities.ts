import {
  Entity,
  Index,
  OptionalProps,
  PrimaryKey,
  Property,
  Unique,
} from '@mikro-orm/core'

/**
 * Versioned additive prompt-override for a registered AI agent (Step 5.3).
 *
 * Each write creates a new row with `version = latest + 1`. Rows are never
 * updated in place — history is preserved so operators can roll back by
 * reading an earlier `version`. Column set is tenant/org-scoped per the
 * standard Open Mercato RBAC contract.
 *
 * `sections` holds additive text keyed by prompt section id. The runtime
 * composes the final `systemPrompt` via `composeSystemPromptWithOverride`
 * (see `lib/prompt-override-merge.ts`), which NEVER replaces a built-in
 * section — overrides are append-only by contract.
 */
@Entity({ tableName: 'ai_agent_prompt_overrides' })
@Unique({
  name: 'ai_agent_prompt_overrides_tenant_org_agent_version_uq',
  properties: ['tenantId', 'organizationId', 'agentId', 'version'],
})
@Index({
  name: 'ai_agent_prompt_overrides_tenant_agent_idx',
  properties: ['tenantId', 'agentId'],
})
@Index({
  name: 'ai_agent_prompt_overrides_tenant_org_agent_version_idx',
  expression:
    'create index "ai_agent_prompt_overrides_tenant_org_agent_version_idx" on "ai_agent_prompt_overrides" ("tenant_id", "organization_id", "agent_id", "version" desc)',
})
export class AiAgentPromptOverride {
  [OptionalProps]?: 'createdAt' | 'updatedAt' | 'organizationId' | 'createdByUserId' | 'notes'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId?: string | null

  @Property({ name: 'agent_id', type: 'text' })
  agentId!: string

  @Property({ name: 'version', type: 'int' })
  version!: number

  @Property({ name: 'sections', type: 'jsonb' })
  sections!: Record<string, string>

  @Property({ name: 'notes', type: 'text', nullable: true })
  notes?: string | null

  @Property({ name: 'created_by_user_id', type: 'uuid', nullable: true })
  createdByUserId?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}
