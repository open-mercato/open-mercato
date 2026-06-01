import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

/**
 * Optimistic-locking UI-coverage regression audit (#2191 / #2055).
 *
 * Flags backend UI files that perform a mutating call — `deleteCrud(`,
 * `updateCrud(`, or a raw `apiCall*` with `method: 'PUT' | 'PATCH' | 'DELETE'`
 * — without participating in OSS optimistic locking, so a *new* raw mutation
 * cannot silently ship without sending the expected-version header.
 *
 * A file is considered COVERED when it references any of the lock primitives
 * (`buildOptimisticLockHeader`, `withScopedApiRequestHeaders`,
 * `withOptimisticLockFor*`, `optimisticLockUpdatedAt`, `disableOptimisticLock`)
 * or is a `<CrudForm>` host (which auto-derives the header from
 * `initialValues.updatedAt` for its own submit/delete).
 *
 * The KNOWN_UNWIRED allowlist freezes the surfaces that still need wiring or an
 * explicit exclusion — tracked in **#2373**. As each is wired, remove it here;
 * as each is excluded, keep it with a one-line reason. Any NEW mutating UI file
 * not covered and not allowlisted fails this test.
 */

const MUTATION = /\b(deleteCrud|updateCrud)\s*\(|method:\s*['"](PUT|PATCH|DELETE)['"]/
const COVERED =
  /buildOptimisticLockHeader|withScopedApiRequestHeaders|withOptimisticLockFor|optimisticLockUpdatedAt|disableOptimisticLock|<CrudForm/

// Paths relative to packages/core/src — tracked for wiring/exclusion in #2373.
const KNOWN_UNWIRED = new Set<string>([
  'modules/api_keys/backend/api-keys/page.tsx',
  'modules/attachments/components/AttachmentPartitionSettings.tsx',
  'modules/business_rules/backend/rules/page.tsx',
  'modules/business_rules/backend/sets/page.tsx',
  'modules/catalog/components/categories/CategoriesDataTable.tsx',
  'modules/catalog/components/products/ProductMediaManager.tsx',
  'modules/currencies/backend/currencies/page.tsx',
  'modules/currencies/backend/exchange-rates/page.tsx',
  'modules/currencies/components/CurrencyFetchingConfig.tsx',
  'modules/customer_accounts/backend/customer_accounts/roles/page.tsx',
  'modules/customer_accounts/backend/customer_accounts/settings/domain/page.tsx',
  'modules/customer_accounts/backend/customer_accounts/users/[id]/page.tsx',
  'modules/customer_accounts/backend/customer_accounts/users/page.tsx',
  'modules/customers/backend/config/customers/deals/page.tsx',
  'modules/customers/backend/config/customers/pipeline-stages/page.tsx',
  'modules/customers/backend/customers/companies/[id]/page.tsx',
  'modules/customers/backend/customers/companies/page.tsx',
  'modules/customers/backend/customers/people/[id]/page.tsx',
  'modules/customers/backend/customers/people/page.tsx',
  'modules/customers/components/AddressFormatSettings.tsx',
  'modules/customers/components/DictionarySettings.tsx',
  'modules/customers/components/PipelineSettings.tsx',
  'modules/customers/components/detail/AddressesSection.tsx',
  'modules/customers/components/detail/CompanyPeopleSection.tsx',
  'modules/customers/components/detail/DealsSection.tsx',
  'modules/customers/components/detail/EntityTagsDialog.tsx',
  'modules/customers/components/detail/ManageTagsDialog.tsx',
  'modules/customers/components/detail/PersonCompaniesSection.tsx',
  'modules/customers/components/detail/RoleAssignmentRow.tsx',
  'modules/dashboards/components/WidgetVisibilityEditor.tsx',
  'modules/data_sync/backend/data-sync/page.tsx',
  'modules/data_sync/components/IntegrationScheduleTab.tsx',
  'modules/dictionaries/components/DictionariesManager.tsx',
  'modules/dictionaries/components/DictionaryEntriesEditor.tsx',
  'modules/directory/backend/directory/organizations/page.tsx',
  'modules/directory/backend/directory/tenants/page.tsx',
  'modules/entities/backend/entities/user/[entityId]/records/page.tsx',
  'modules/feature_toggles/components/FeatureTogglesTable.tsx',
  'modules/inbox_ops/backend/inbox-ops/settings/page.tsx',
  'modules/inbox_ops/components/proposals/EditActionDialog.tsx',
  'modules/integrations/backend/integrations/bundle/[id]/page.tsx',
  'modules/integrations/backend/integrations/page.tsx',
  'modules/planner/backend/planner/availability-rulesets/[id]/page.tsx',
  'modules/resources/backend/resources/resource-types/[id]/edit/page.tsx',
  'modules/sales/backend/sales/documents/create/page.tsx',
  'modules/sales/components/AdjustmentKindSettings.tsx',
  'modules/sales/components/DocumentNumberSettings.tsx',
  'modules/sales/components/OrderEditingSettings.tsx',
  'modules/sales/components/StatusSettings.tsx',
  'modules/sales/components/channels/SalesChannelOffersPanel.tsx',
  'modules/sales/components/documents/AddressesSection.tsx',
  'modules/sales/components/documents/SalesDocumentsTable.tsx',
  'modules/staff/backend/staff/leave-requests/[id]/page.tsx',
  'modules/staff/backend/staff/my-leave-requests/[id]/page.tsx',
  'modules/staff/backend/staff/team-roles/[id]/edit/page.tsx',
  'modules/translations/components/TranslationManager.tsx',
  'modules/workflows/backend/definitions/visual-editor/page.tsx',
])

const srcRoot = join(__dirname, '..')
const modulesRoot = join(srcRoot, 'modules')

function collectTsx(dir: string, acc: string[]): void {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const name of entries) {
    const full = join(dir, name)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      if (name === 'node_modules' || name === '__tests__' || name === 'generated') continue
      collectTsx(full, acc)
    } else if (name.endsWith('.tsx') && !name.endsWith('.test.tsx')) {
      acc.push(full)
    }
  }
}

describe('optimistic locking — mutating UI calls send the version header (or are allowlisted)', () => {
  const files: string[] = []
  collectTsx(modulesRoot, files)
  // Only backend pages + components host mutating UI flows.
  const candidates = files.filter((f) => f.includes(`${sep}backend${sep}`) || f.includes(`${sep}components${sep}`))

  it('discovered backend/component tsx files to scan', () => {
    expect(candidates.length).toBeGreaterThan(50)
  })

  it('every mutating UI file is covered or explicitly allowlisted (#2373)', () => {
    const violations: string[] = []
    for (const full of candidates) {
      const source = readFileSync(full, 'utf8')
      if (!MUTATION.test(source)) continue
      if (COVERED.test(source)) continue
      const rel = relative(srcRoot, full).split(sep).join('/')
      if (KNOWN_UNWIRED.has(rel)) continue
      violations.push(rel)
    }
    expect(violations).toEqual([])
  })
})
