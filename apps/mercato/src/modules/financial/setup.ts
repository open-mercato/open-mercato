import type { EntityManager } from '@mikro-orm/postgresql'
import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import type { ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import { GlAccount, GlCashAccount, GlPaymentMethod, type PaymentMethodKind } from './data/entities'
import { resolveFinancialCountryPlugin } from './lib/registries'
import { seedChartOfAccounts } from './lib/chartOfAccounts'
import { readFinancialJurisdiction } from './lib/jurisdiction'

/**
 * Reference data a tenant can immediately use, seeded by **code** so re-running
 * creates nothing twice and a tenant that renamed a row keeps its name.
 *
 * Payment methods are seeded rather than left empty because a ledger with no way
 * to say "this was cash" forces every tenant to invent the same six rows, and
 * because Cash has to exist before a cash payment can be recorded at all. The
 * accounts they point at are resolved from the chart of accounts, so seeding is
 * skipped — not failed — when the chart has not been seeded yet: a tenant that
 * opens its books later gets the methods, and one that never does is not left
 * with methods pointing at nothing.
 */
type SeedScope = { tenantId: string; organizationId: string; em: EntityManager }

const DEFAULT_PAYMENT_METHODS: readonly {
  code: string
  name: string
  kind: PaymentMethodKind
  accountType: string
  isDefault?: boolean
  requiresReference?: boolean
  sortOrder: number
}[] = [
  { code: 'CASH', name: 'Cash', kind: 'cash', accountType: 'cash', isDefault: true, sortOrder: 10 },
  { code: 'BANK_TRANSFER', name: 'Bank transfer', kind: 'bank_transfer', accountType: 'bank', requiresReference: true, sortOrder: 20 },
  { code: 'MADA', name: 'Mada', kind: 'card', accountType: 'bank', requiresReference: true, sortOrder: 30 },
  { code: 'CARD', name: 'Credit card', kind: 'card', accountType: 'bank', requiresReference: true, sortOrder: 40 },
  { code: 'CHEQUE', name: 'Cheque', kind: 'cheque', accountType: 'bank', requiresReference: true, sortOrder: 50 },
  { code: 'STC_PAY', name: 'STC Pay', kind: 'wallet', accountType: 'bank', requiresReference: true, sortOrder: 60 },
]

async function resolveAccountIdByType(scope: SeedScope, accountType: string): Promise<string | null> {
  const account = await scope.em.findOne(GlAccount, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    accountType,
    accountClass: 'asset',
    deletedAt: null,
  })
  return account?.id ?? null
}

async function seedPaymentMethods(scope: SeedScope): Promise<void> {
  for (const definition of DEFAULT_PAYMENT_METHODS) {
    const existing = await scope.em.findOne(GlPaymentMethod, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      code: definition.code,
    })
    if (existing) continue
    const accountId = await resolveAccountIdByType(scope, definition.accountType)
    if (!accountId) continue
    scope.em.persist(
      scope.em.create(GlPaymentMethod, {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        code: definition.code,
        name: definition.name,
        kind: definition.kind,
        accountId,
        isDefault: definition.isDefault ?? false,
        requiresReference: definition.requiresReference ?? false,
        sortOrder: definition.sortOrder,
      }),
    )
  }
  await scope.em.flush()
}

async function seedCashAccount(scope: SeedScope): Promise<void> {
  const existing = await scope.em.findOne(GlCashAccount, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    code: 'CASH',
  })
  if (existing) return
  const accountId = await resolveAccountIdByType(scope, 'cash')
  if (!accountId) return
  const account = await scope.em.findOne(GlAccount, { id: accountId })
  scope.em.persist(
    scope.em.create(GlCashAccount, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      code: 'CASH',
      name: 'Cash on hand',
      kind: 'cash',
      accountId,
      currencyCode: account?.currencyCode ?? 'SAR',
      isDefault: true,
    }),
  )
  await scope.em.flush()
}

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['financial.*'],
    admin: ['financial.*'],
    employee: ['financial.read', 'financial.payments.view'],
  },

  async seedDefaults({ em, tenantId, organizationId, container }) {
    if (!tenantId || !organizationId) return
    const scope: SeedScope = { tenantId, organizationId, em }

    // The chart first: the payment methods below resolve their GL accounts from
    // it, so seeding them the other way round would leave a tenant with no
    // methods at all on a first run.
    const configService = resolveConfigService(container)
    const countryCode = await readFinancialJurisdiction(configService, { tenantId, organizationId })
    if (countryCode) {
      const template = resolveFinancialCountryPlugin(countryCode).chartOfAccounts
      if (template && template.listAccounts().length > 0) {
        await seedChartOfAccounts(em, { tenantId, organizationId }, template, {
          currencyCode: resolveFinancialCountryPlugin(countryCode).tax.currencyCode,
          countryCode,
        })
      }
    }

    await seedPaymentMethods(scope)
    await seedCashAccount(scope)
  },
}

function resolveConfigService(container: unknown): ModuleConfigService | null {
  try {
    return (container as { resolve: (name: string) => ModuleConfigService }).resolve('moduleConfigService')
  } catch {
    // A container without the configs module is a legitimate deployment; the
    // jurisdiction is then simply unset and the generic rules apply.
    return null
  }
}

export default setup
