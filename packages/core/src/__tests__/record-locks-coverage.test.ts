import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * record_locks entity decision-map coverage guard
 * (spec `.ai/specs/enterprise/2026-06-09-record-locks-unified-coverage.md`, Phase 7).
 *
 * `optimistic-lock-editable-entities.test.ts` pins the OSS floor: every audited
 * user-editable entity must expose an `updated_at` column. This guard pins the
 * ENTERPRISE layer on top of it: every one of those same audited entities must
 * also carry an explicit `record_locks` decision — either **enabled**
 * (presence + the unified guard layered on the OSS floor) or **exempt** (with a
 * one-line reason). A new audited editable entity therefore cannot ship without
 * a deliberate record_locks decision; it fails here until one is added.
 *
 * Source of truth: the audited entity list is parsed directly from
 * `optimistic-lock-editable-entities.test.ts` so the two guards can never drift —
 * adding `moduleEntities[...]` there immediately requires a decision here.
 *
 * Scope: this guard covers the CRUD-layer editable entities only. The
 * command-helper sites and the raw UI header-helper sites have their own
 * decision maps (`optimistic-lock-command-coverage.test.ts` and
 * `optimistic-lock-ui-coverage-workspace.test.ts` respectively); they are
 * referenced, not duplicated, here.
 *
 * Decisions are seeded from the implemented Coverage Matrix + the run ledger
 * (`.ai/runs/2026-06-09-record-locks-IMPL-ledger.md`). With
 * `DEFAULT_RECORD_LOCK_SETTINGS.enabledResources = ['*']` every resourceKind is
 * enrolled by default, so the standard decision is "enabled": the CRUD decorator
 * runs the OSS `updated_at` floor first and then the record_locks enrichment.
 * The only documented exception is `feature_toggles:FeatureToggle`
 * (global / non-tenant scope) which stays OSS-floor-only.
 */

type RecordLockDecision = {
  /** "enabled" = unified guard (floor + record_locks); "exempt" = floor-only / not engaged. */
  status: 'enabled' | 'exempt'
  /** The record_locks resource key (`<module>.<entity>`), or '' for exempt sites. */
  resourceKind: string
  /** One-line justification (required for exempt; describes the guard for enabled). */
  reason: string
}

/**
 * Keyed by `<moduleId>:<EntityClassName>` (matching the audited entity list).
 * resourceKinds mirror the ACTUAL kinds wired during implementation (e.g.
 * `catalog.category`, `business_rules.ruleSet`, dot-notation kinds) rather than
 * a mechanical `<module>.<snake_entity>`.
 */
const RECORD_LOCKS_DECISIONS: Record<string, RecordLockDecision> = {
  // --- auth ---
  'auth:User': { status: 'enabled', resourceKind: 'auth.user', reason: 'enabled — presence + CRUD decorator (floor + record_locks); ACL routes versioned separately.' },
  'auth:Role': { status: 'enabled', resourceKind: 'auth.role', reason: 'enabled — presence + CRUD decorator (floor + record_locks); ACL routes versioned separately.' },

  // --- catalog ---
  'catalog:CatalogProduct': { status: 'enabled', resourceKind: 'catalog.product', reason: 'enabled — presence mount + CRUD decorator (floor + record_locks).' },
  'catalog:CatalogProductVariant': { status: 'enabled', resourceKind: 'catalog.variant', reason: 'enabled — presence mount + injectionSpotId + CRUD decorator.' },
  'catalog:CatalogProductCategory': { status: 'enabled', resourceKind: 'catalog.category', reason: 'enabled — presence mount + injectionSpotId + CRUD decorator. resourceKind `catalog.category` matches the existing versionHistory widget + server CRUD guard.' },
  'catalog:CatalogProductPrice': { status: 'enabled', resourceKind: 'catalog.product_price', reason: 'enabled — CRUD decorator; presence inherited from the product screen (no dedicated detail screen).' },
  'catalog:CatalogOffer': { status: 'enabled', resourceKind: 'catalog.offer', reason: 'enabled — CRUD decorator; presence inherited from the product screen.' },
  'catalog:CatalogPriceKind': { status: 'enabled', resourceKind: 'catalog.price_kind', reason: 'enabled — CRUD decorator; custom PriceKindSettings dialog sends the lock header + surfaces the conflict.' },
  'catalog:CatalogOptionSchemaTemplate': { status: 'enabled', resourceKind: 'catalog.option_schema_template', reason: 'enabled — CRUD decorator; presence inherited from the product/variant forms.' },

  // --- customers ---
  'customers:CustomerEntity': { status: 'enabled', resourceKind: 'customers.person', reason: 'enabled — Phase 1; presence (person/company) + unified guard. Company shares the same entity via `customers.company`.' },
  'customers:CustomerDeal': { status: 'enabled', resourceKind: 'customers.deal', reason: 'enabled — Phase 1; DealForm injectionSpotId + form/command guard. Detail-screen stage/closure ride the customers.deals.update CRUD route (auto-guarded); the custom command endpoints are the bulk ones.' },
  'customers:CustomerInteraction': { status: 'enabled', resourceKind: 'customers.interaction', reason: 'enabled — Phase 2; interactions migrated to the async command seam + merge surface. Status-transition endpoints (complete/cancel/visibility) are state-machine writes.' },
  'customers:CustomerTag': { status: 'enabled', resourceKind: 'customers.tag', reason: 'enabled — entity edit via CRUD decorator; tag assign/unassign is a junction (exempt).' },
  'customers:CustomerLabel': { status: 'enabled', resourceKind: 'customers.label', reason: 'enabled — entity edit via CRUD decorator; label assign/unassign is a junction (exempt).' },
  'customers:CustomerPipeline': { status: 'enabled', resourceKind: 'customers.pipeline', reason: 'enabled — Phase 2; pipelines gained a command guard.' },
  'customers:CustomerPipelineStage': { status: 'enabled', resourceKind: 'customers.pipeline_stage', reason: 'enabled — Phase 2; pipeline-stages gained a command guard; reorder is a position write (exempt).' },

  // --- sales ---
  'sales:SalesOrder': { status: 'enabled', resourceKind: 'sales.order', reason: 'enabled — Phase 3; parent-order aggregate command guard via the async seam; presence on documents/[id].' },
  'sales:SalesQuote': { status: 'enabled', resourceKind: 'sales.quote', reason: 'enabled — Phase 3; aggregate command guard via the async seam; presence on documents/[id].' },
  'sales:SalesChannel': { status: 'enabled', resourceKind: 'sales.sales_channel', reason: 'enabled — config CRUD decorator.' },
  'sales:SalesPaymentMethod': { status: 'enabled', resourceKind: 'sales.sales_payment_method', reason: 'enabled — config CRUD decorator.' },
  'sales:SalesShippingMethod': { status: 'enabled', resourceKind: 'sales.sales_shipping_method', reason: 'enabled — config CRUD decorator.' },

  // --- staff ---
  'staff:StaffTeam': { status: 'enabled', resourceKind: 'staff.team', reason: 'enabled — Phase 5; presence + CRUD decorator. Notes/addresses sub-resources send the lock header (Phase 7).' },
  'staff:StaffTeamRole': { status: 'enabled', resourceKind: 'staff.team_role', reason: 'enabled — Phase 5; presence + CRUD decorator. Team-member/leave-request edits enabled too; accept/reject = status txn.' },

  // --- resources ---
  'resources:ResourcesResource': { status: 'enabled', resourceKind: 'resources.resource', reason: 'enabled — Phase 5; presence + CRUD decorator. Notes sub-resource sends the lock header (Phase 7); tags exempt.' },
  'resources:ResourcesResourceType': { status: 'enabled', resourceKind: 'resources.resource_type', reason: 'enabled — Phase 5; presence + CRUD decorator.' },

  // --- dictionaries ---
  'dictionaries:Dictionary': { status: 'enabled', resourceKind: 'dictionaries.dictionary', reason: 'enabled — Phase 6; routes migrated to the async command seam.' },
  'dictionaries:DictionaryEntry': { status: 'enabled', resourceKind: 'dictionaries.entry', reason: 'enabled — Phase 6; entry routes migrated to the async command seam; reorder/set-default exempt.' },

  // --- currencies ---
  'currencies:Currency': { status: 'enabled', resourceKind: 'currencies.currency', reason: 'enabled — Phase 6; presence + CRUD decorator; list/detail deletes surface the conflict.' },

  // --- business_rules ---
  'business_rules:BusinessRule': { status: 'enabled', resourceKind: 'business_rules.rule', reason: 'enabled — Phase 6; routes migrated to the async command seam; presence on rules/[id].' },
  'business_rules:RuleSet': { status: 'enabled', resourceKind: 'business_rules.ruleSet', reason: 'enabled — Phase 6; routes migrated to the async command seam; presence on sets/[id]. resourceKind `business_rules.ruleSet` matches the existing widget.' },

  // --- feature_toggles ---
  'feature_toggles:FeatureToggle': { status: 'exempt', resourceKind: '', reason: 'OSS-floor-only — the global FeatureToggle is a non-tenant, superadmin-only entity; record_locks enrichment is tenant/org-scoped, so the global toggle stays guarded by the OSS `updated_at` floor only (no presence). Per-tenant overrides ARE command-guarded (feature_toggles:FeatureToggleOverride, Phase 6b).' },

  // --- workflows ---
  'workflows:WorkflowDefinition': { status: 'enabled', resourceKind: 'workflows.definition', reason: 'enabled — Phase 6; form detail + visual editor presence; route uses validateCrudMutationGuard + generic reader (floor + record_locks).' },

  // --- directory ---
  'directory:Organization': { status: 'enabled', resourceKind: 'directory.organization', reason: 'enabled — Phase 5; presence + CRUD decorator (admin view).' },
  'directory:Tenant': { status: 'enabled', resourceKind: 'directory.tenant', reason: 'enabled — Phase 5; presence + CRUD decorator.' },

  // --- messages ---
  'messages:Message': { status: 'exempt', resourceKind: 'messages.message', reason: 'OSS-floor-only — draft edits + message actions are hand-written command routes (no makeCrudRoute decorator surface); they enforce the synchronous OSS `enforceCommandOptimisticLock` updated_at floor and surface the conflict on the shared banner (#3260). The two call sites are allowlisted in optimistic-lock-command-coverage. Enterprise record_locks migration deferred.' },
}

/**
 * Parse the audited `moduleEntities` object from the OSS editable-entities guard
 * so this decision map is forced to stay in lockstep with that audit. Returns a
 * flat list of `<moduleId>:<EntityClassName>` keys.
 */
function parseAuditedEntities(): string[] {
  const source = readFileSync(
    join(__dirname, 'optimistic-lock-editable-entities.test.ts'),
    'utf8',
  )
  const start = source.indexOf('const moduleEntities')
  if (start < 0) throw new Error('[internal] could not locate moduleEntities in the editable-entities guard')
  const objStart = source.indexOf('{', start)
  // Walk braces to find the matching close of the object literal.
  let depth = 0
  let objEnd = -1
  for (let i = objStart; i < source.length; i += 1) {
    const ch = source[i]
    if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) {
        objEnd = i
        break
      }
    }
  }
  if (objEnd < 0) throw new Error('[internal] could not parse the moduleEntities object literal')
  const block = source.slice(objStart, objEnd + 1)

  const keys: string[] = []
  // Match each `moduleId: [ ... ]` group, then the quoted class names inside.
  const moduleRe = /(\w+)\s*:\s*\[([^\]]*)\]/g
  let moduleMatch: RegExpExecArray | null
  while ((moduleMatch = moduleRe.exec(block)) !== null) {
    const moduleId = moduleMatch[1]
    const inner = moduleMatch[2]
    const classRe = /['"]([A-Za-z0-9_]+)['"]/g
    let classMatch: RegExpExecArray | null
    while ((classMatch = classRe.exec(inner)) !== null) {
      keys.push(`${moduleId}:${classMatch[1]}`)
    }
  }
  return keys
}

describe('record_locks coverage — every audited editable entity has a record_locks decision', () => {
  const auditedEntities = parseAuditedEntities()

  it('parsed a non-trivial set of audited editable entities from the OSS guard', () => {
    // Sanity floor: if this drops, the parser broke (and the lockstep guarantee with it).
    expect(auditedEntities.length).toBeGreaterThanOrEqual(30)
  })

  it('every audited editable entity carries a record_locks decision (enabled or exempt)', () => {
    const missing = auditedEntities.filter((key) => !(key in RECORD_LOCKS_DECISIONS))
    expect(missing).toEqual([])
  })

  it('the decision map has no stale entries (every decision maps to an audited entity)', () => {
    const audited = new Set(auditedEntities)
    const stale = Object.keys(RECORD_LOCKS_DECISIONS).filter((key) => !audited.has(key))
    expect(stale).toEqual([])
  })

  it('every decision is well-formed (valid status, reason, and resourceKind shape)', () => {
    for (const [key, decision] of Object.entries(RECORD_LOCKS_DECISIONS)) {
      expect(decision.status === 'enabled' || decision.status === 'exempt').toBe(true)
      expect(typeof decision.reason).toBe('string')
      expect(decision.reason.trim().length).toBeGreaterThan(0)
      if (decision.status === 'enabled') {
        // An enabled site must name the resourceKind it engages.
        const enabledWithoutResourceKind = decision.resourceKind.trim().length === 0 ? key : null
        expect(enabledWithoutResourceKind).toBeNull()
      }
    }
  })
})
