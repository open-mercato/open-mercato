import { OptionalProps } from '@mikro-orm/core'
import { Entity, Index, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy'

export type CustomerGroupKind = 'b2c' | 'b2b' | 'internal' | 'partner'
export type CustomerGroupMembershipSource = 'manual' | 'import' | 'rule' | 'onboarding'

// Groups are tenant-scoped, not organization-scoped — spec §5 note: "groups are
// tenant-scoped here, consistent with `CatalogPriceKind`, which allows a null
// `organization_id`" (see .ai/specs/2026-08-14-customer-groups-and-b2b-terms.md §Open
// Questions #2). `organizationId` is kept as a nullable column (mirroring
// `CatalogPriceKind`) rather than dropped, so a future per-organization private-group
// phase (explicitly out of scope here) can scope rows without a schema change.
@Entity({ tableName: 'customer_groups' })
@Index({ name: 'customer_groups_tenant_idx', properties: ['tenantId'] })
@Index({ name: 'customer_groups_parent_idx', properties: ['parentId'] })
@Unique({ name: 'customer_groups_tenant_code_unique', properties: ['tenantId', 'code'] })
@Index({
  // Partial (not @Unique) so a soft-deleted group's old priority value doesn't stay
  // permanently reserved — found during Step 1.6/1.7: the admin list's drag-reorder
  // rewrites priorities in gaps of 10, which would otherwise collide with any
  // previously-deleted row's still-unique priority and 409 forever, not just on a
  // transient race. Mirrors `customer_groups_tenant_default_unique` below.
  name: 'customer_groups_tenant_priority_unique',
  expression:
    'create unique index "customer_groups_tenant_priority_unique" on "customer_groups" ("tenant_id", "priority") where "deleted_at" is null',
})
@Index({
  // "At most one is_default per tenant" (spec §5.1) is primarily an application-level
  // invariant enforced in the create/update command, but a partial unique index gives
  // defense-in-depth against races/direct writes at negligible cost — this repo already
  // has the identical shape for "at most one is_primary per deal" (see
  // `customer_deal_people_primary_uq` in the customers module). Soft-deleted rows are
  // excluded so a deleted former default doesn't block promoting a new one.
  name: 'customer_groups_tenant_default_unique',
  expression:
    'create unique index "customer_groups_tenant_default_unique" on "customer_groups" ("tenant_id") where "is_default" and "deleted_at" is null',
})
export class CustomerGroup {
  [OptionalProps]?: 'isDefault' | 'isActive' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId?: string | null

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ type: 'text' })
  code!: string

  @Property({ type: 'text' })
  name!: string

  @Property({ type: 'text', nullable: true })
  description?: string | null

  @Property({ type: 'text' })
  kind!: CustomerGroupKind

  // Self-referencing hierarchy stored as a plain uuid column (not a MikroORM
  // `@ManyToOne` self-relation) to match this codebase's established pattern for
  // parent/child ids within the same module — see `CatalogCategory.parentId` in
  // `packages/core/src/modules/catalog/data/entities.ts`. Cycle prevention (depth
  // capped at 5 per spec §5.1) is enforced in the create/update command, not the ORM.
  @Property({ name: 'parent_id', type: 'uuid', nullable: true })
  parentId?: string | null

  @Property({ type: 'int' })
  priority!: number

  // DB-level defense-in-depth is `customer_groups_tenant_default_unique` above; the
  // primary enforcement (clear-and-set semantics when reassigning the default) is the
  // create/update command's job, not the ORM's.
  @Property({ name: 'is_default', type: 'boolean', default: false })
  isDefault: boolean = false

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown> | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

// `group_id`/`customer_id` are plain uuid columns rather than MikroORM relations:
// `customerId` crosses into the `customers` module, which the root AGENTS.md forbids
// ("Never create direct ORM relationships between modules" — FK id only, resolved
// separately). `groupId` stays a plain column too (not `@ManyToOne(() => CustomerGroup)`)
// for symmetry with the customer-id column and to match this codebase's convention for
// scoped junction/assignment tables that reference a same-module parent by id only
// (e.g. `CustomerPipelineStage.pipelineId` in the customers module).
@Entity({ tableName: 'customer_group_memberships' })
@Index({ name: 'customer_group_memberships_tenant_idx', properties: ['tenantId'] })
@Index({
  name: 'customer_group_memberships_hot_path_idx',
  properties: ['tenantId', 'customerId', 'validFrom', 'validUntil'],
})
@Index({
  // Spec §5.2: unique `(tenant_id, group_id, customer_id)` among rows with
  // `deleted_at IS NULL` — expressed as a partial unique index (not `@Unique`, which
  // has no WHERE clause) so a removed (soft-deleted) membership can be re-added without
  // colliding with its own tombstoned row. Mirrors
  // `customer_person_company_links_active_unique` in the customers module.
  name: 'customer_group_memberships_active_unique',
  expression:
    'create unique index "customer_group_memberships_active_unique" on "customer_group_memberships" ("tenant_id", "group_id", "customer_id") where "deleted_at" is null',
})
export class CustomerGroupMembership {
  [OptionalProps]?: 'source' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId?: string | null

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'group_id', type: 'uuid' })
  groupId!: string

  @Property({ name: 'customer_id', type: 'uuid' })
  customerId!: string

  @Property({ type: 'text', default: 'manual' })
  source: CustomerGroupMembershipSource = 'manual'

  @Property({ name: 'valid_from', type: Date, nullable: true })
  validFrom?: Date | null

  @Property({ name: 'valid_until', type: Date, nullable: true })
  validUntil?: Date | null

  @Property({ name: 'assigned_by_user_id', type: 'uuid', nullable: true })
  assignedByUserId?: string | null

  @Property({ type: 'text', nullable: true })
  notes?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}
