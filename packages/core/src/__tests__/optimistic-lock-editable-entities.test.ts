import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Optimistic-locking coverage guard (#2055).
 *
 * OSS optimistic locking is default-ON for every `makeCrudRoute` entity, and
 * `CrudForm` auto-derives the version header from `initialValues.updatedAt`.
 * That auto-derive **silently no-ops** when the loaded record has no
 * `updatedAt` — so an editable entity whose table lacks an `updated_at` column
 * *looks* protected but actually allows silent lost updates.
 *
 * This test pins the audited invariant: every genuinely **user-editable**
 * business / config entity (one with a UI edit form + update flow) MUST expose
 * an `updated_at` column. A new editable entity shipped without it, or a
 * removal of the column, fails here instead of silently dropping protection.
 *
 * Deliberately EXCLUDED (no concurrent field-edit lost-update risk, so no
 * `updated_at` required): append-only logs / audits / events, background-job &
 * coverage rows, session / token / verification / recovery rows, pure
 * junction / assignment tables (add-remove, not field-edited), sub-resource
 * LINE / ITEM / ALLOCATION rows guarded by their parent document's aggregate
 * version, webhook-receipt / idempotency rows, and state-machine rows guarded
 * by an explicit status check (e.g. notifications dismiss/restore,
 * ai_pending_actions confirm/cancel). Custom field VALUES are written only via
 * their parent entity's guarded update command, so they inherit the parent's
 * version — also excluded.
 */

const moduleEntities: Record<string, string[]> = {
  auth: ['User', 'Role'],
  catalog: [
    'CatalogProduct',
    'CatalogProductVariant',
    'CatalogProductCategory',
    'CatalogProductPrice',
    'CatalogOffer',
    'CatalogPriceKind',
    'CatalogOptionSchemaTemplate',
  ],
  customers: [
    'CustomerEntity',
    'CustomerDeal',
    'CustomerInteraction',
    'CustomerTag',
    'CustomerLabel',
    'CustomerPipeline',
    'CustomerPipelineStage',
  ],
  sales: ['SalesOrder', 'SalesQuote', 'SalesChannel', 'SalesPaymentMethod', 'SalesShippingMethod'],
  staff: ['StaffTeam', 'StaffTeamRole'],
  resources: ['ResourcesResource', 'ResourcesResourceType'],
  dictionaries: ['Dictionary', 'DictionaryEntry'],
  currencies: ['Currency'],
  devices: ['UserDevice'],
  business_rules: ['BusinessRule', 'RuleSet'],
  feature_toggles: ['FeatureToggle'],
  workflows: ['WorkflowDefinition'],
  directory: ['Organization', 'Tenant'],
}

function readEntitySource(moduleId: string): string {
  return readFileSync(
    join(__dirname, '..', 'modules', moduleId, 'data', 'entities.ts'),
    'utf8',
  )
}

/** Extract a single top-level entity class block (exact name match). */
function classBlock(source: string, className: string): string | null {
  const match = new RegExp(`export class ${className}\\b`).exec(source)
  if (!match) return null
  const rest = source.slice(match.index + match[0].length)
  const nextIdx = rest.search(/\nexport (class|type|const|function|interface) /)
  return nextIdx >= 0 ? rest.slice(0, nextIdx) : rest
}

describe('optimistic locking — every user-editable entity exposes updated_at', () => {
  for (const [moduleId, classes] of Object.entries(moduleEntities)) {
    const source = readEntitySource(moduleId)
    for (const className of classes) {
      it(`${moduleId}: ${className} has an updated_at column`, () => {
        const block = classBlock(source, className)
        // null = class renamed/removed — surface that too, it likely needs re-auditing.
        expect(block).not.toBeNull()
        expect(block as string).toMatch(/name:\s*['"]updated_at['"]/)
      })
    }
  }
})
