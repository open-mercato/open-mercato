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
  messages: ['Message'],
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

/**
 * Reader-resolution guard (the durable fix for the `customers.tag` no-lock-hole
 * CLASS, found by the record_locks docker integration run).
 *
 * The OSS optimistic-lock guard only protects an entity if its reader can run.
 * `makeCrudRoute` auto-registers `createGenericOptimisticLockReader`, which by
 * default filters on `deletedAt: null`. If the entity's TABLE has no
 * `deleted_at` column AND the route does not pass `softDeleteField: null`, the
 * reader's `findOne` throws, the catch returns `null`, and the guard treats the
 * row as "already gone" — silently letting a stale write through (200 instead of
 * 409). `customer_tags` shipped exactly this misconfig.
 *
 * For every audited editable entity, the reader MUST be resolvable. That holds
 * when either:
 *   (a) the entity's ORM class has a `deleted_at` column (the default reader
 *       filter is valid), OR
 *   (b) every `makeCrudRoute` route that uses the entity as `orm.entity` sets
 *       `softDeleteField: null` (the implicit not-deleted filter is disabled), OR
 *   (c) no `makeCrudRoute` route uses the entity — its locking is wired at the
 *       command layer (`enforceCommandOptimisticLock*`) or via a hand-registered
 *       custom reader, which read `updated_at` directly and never touch the
 *       generic reader's soft-delete filter.
 *
 * This statically FAILS for the `customer_tags` misconfig (no `deleted_at` +
 * `makeCrudRoute` route without `softDeleteField: null`) and PASSES once the
 * route opts out of the soft-delete filter.
 */

// Audit map: audited entity ORM class -> the makeCrudRoute route file(s) that
// use it as `orm.entity` (relative to packages/core/src/modules). Entities whose
// lock is wired at the command layer / via a custom reader (no makeCrudRoute
// entity) are intentionally absent — see case (c) above.
const makeCrudRouteByEntity: Record<string, string[]> = {
  User: ['auth/api/users/route.ts'],
  Role: ['auth/api/roles/route.ts'],
  CatalogProduct: ['catalog/api/products/route.ts'],
  CatalogProductVariant: ['catalog/api/variants/route.ts'],
  CatalogProductCategory: ['catalog/api/categories/route.ts'],
  CatalogProductPrice: ['catalog/api/prices/route.ts'],
  CatalogOffer: ['catalog/api/offers/route.ts'],
  CatalogPriceKind: ['catalog/api/price-kinds/route.ts'],
  CatalogOptionSchemaTemplate: ['catalog/api/option-schemas/route.ts'],
  CustomerEntity: ['customers/api/people/route.ts', 'customers/api/companies/route.ts'],
  CustomerDeal: ['customers/api/deals/route.ts'],
  CustomerInteraction: ['customers/api/interactions/route.ts'],
  CustomerTag: ['customers/api/tags/route.ts'],
  // CustomerLabel / CustomerPipeline / CustomerPipelineStage — command-layer guard (case c).
  SalesOrder: ['sales/api/orders/route.ts'],
  SalesQuote: ['sales/api/quotes/route.ts'],
  SalesChannel: ['sales/api/channels/route.ts'],
  SalesPaymentMethod: ['sales/api/payment-methods/route.ts'],
  SalesShippingMethod: ['sales/api/shipping-methods/route.ts'],
  StaffTeam: ['staff/api/teams.ts'],
  StaffTeamRole: ['staff/api/team-roles.ts'],
  ResourcesResource: ['resources/api/resources.ts'],
  ResourcesResourceType: ['resources/api/resource-types.ts'],
  // Dictionary / BusinessRule / RuleSet — command-layer guard (case c).
  DictionaryEntry: ['sales/api/adjustment-kinds/route.ts', 'sales/lib/makeStatusDictionaryRoute.ts'],
  Currency: ['currencies/api/currencies/route.ts'],
  FeatureToggle: ['feature_toggles/api/global/route.ts'],
  WorkflowDefinition: ['workflows/api/definitions/[id]/route.ts'],
  Organization: ['directory/api/organizations/route.ts'],
  Tenant: ['directory/api/tenants/route.ts'],
}

function entityHasDeletedAt(moduleId: string, className: string): boolean {
  const block = classBlock(readEntitySource(moduleId), className)
  return block != null && /name:\s*['"]deleted_at['"]/.test(block)
}

/** Extract the `orm: { ... }` config block immediately following an `entity: <ClassName>,`. */
function ormBlockForEntity(routeSource: string, className: string): string | null {
  const entityMatch = new RegExp(`entity:\\s*${className}\\s*,`).exec(routeSource)
  if (!entityMatch) return null
  // The orm config is a single brace-balanced object; capture from the opening
  // `orm: {` before the entity match to its matching close brace.
  const ormStart = routeSource.lastIndexOf('orm:', entityMatch.index)
  if (ormStart < 0) return null
  const braceStart = routeSource.indexOf('{', ormStart)
  if (braceStart < 0) return null
  let depth = 0
  for (let i = braceStart; i < routeSource.length; i += 1) {
    const ch = routeSource[i]
    if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) return routeSource.slice(braceStart, i + 1)
    }
  }
  return null
}

describe('optimistic locking — generic reader resolves for every audited editable entity', () => {
  for (const [moduleId, classes] of Object.entries(moduleEntities)) {
    for (const className of classes) {
      it(`${moduleId}: ${className} — generic optimistic-lock reader can resolve`, () => {
        if (entityHasDeletedAt(moduleId, className)) return // case (a): default reader filter is valid

        const routes = makeCrudRouteByEntity[className] ?? []
        if (routes.length === 0) return // case (c): command-layer / custom reader

        // case (b): every makeCrudRoute route for a deleted_at-less entity MUST
        // disable the soft-delete filter, else the reader throws and fails open.
        for (const route of routes) {
          const routeSource = readFileSync(join(__dirname, '..', 'modules', route), 'utf8')
          const ormBlock = ormBlockForEntity(routeSource, className)
          expect(ormBlock).not.toBeNull()
          expect(ormBlock as string).toMatch(/softDeleteField:\s*null/)
        }
      })
    }
  }
})
