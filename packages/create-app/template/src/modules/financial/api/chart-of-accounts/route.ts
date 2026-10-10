import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import type { OpenApiMethodDoc, OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { GlAccount } from '../../data/entities'
import { readFinancialJurisdiction, writeFinancialJurisdiction } from '../../lib/jurisdiction'
import {
  GENERIC_COUNTRY_CODE,
  isGenericFinancialCountryPlugin,
  normalizeFinancialCountryCode,
  resolveFinancialCountryPlugin,
} from '../../lib/registries'
import { missingChartCodes, seedChartOfAccounts } from '../../lib/chartOfAccounts'

/**
 * Applying a jurisdiction's chart of accounts to this organization.
 *
 * It is an explicit action rather than something tenant setup performs silently,
 * because the template is a **jurisdiction choice** and this app has nowhere on
 * the organization that records one. `GET` answers what a seed would add, so an
 * operator can look before they leap, and `POST` is idempotent by account code —
 * re-running it after a template gains an account adds only that account.
 *
 * The generic fallback's template is empty, which is the honest answer for an
 * unknown country: there is no chart to impose. Choosing a country with no plugin
 * therefore reports what happened instead of silently seeding nothing.
 */
const logger = createLogger('financial')

export const metadata = {
  path: '/financial/chart-of-accounts',
  GET: { requireAuth: true, requireFeatures: ['financial.read'] },
  POST: { requireAuth: true, requireFeatures: ['financial.admin'] },
}

type Context = {
  container: Awaited<ReturnType<typeof createRequestContainer>>
  tenantId: string
  organizationId: string
  actorId: string
}

async function resolveContext(req: Request): Promise<Context> {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(req)
  const { translate } = await resolveTranslations()
  if (!auth || !auth.tenantId) {
    throw new CrudHttpError(401, { error: translate('errors.unauthorized', 'Unauthorized') })
  }
  if (!auth.orgId) {
    throw new CrudHttpError(400, {
      error: translate('errors.organization_required', 'Organization context is required'),
    })
  }
  return {
    container,
    tenantId: auth.tenantId,
    organizationId: auth.orgId,
    actorId: auth.sub ?? 'system',
  }
}

function resolveCountryCode(value: unknown): string {
  const normalized = normalizeFinancialCountryCode(typeof value === 'string' ? value : null)
  return normalized ?? GENERIC_COUNTRY_CODE
}

async function existingCodes(context: Context): Promise<string[]> {
  const em = context.container.resolve('em') as EntityManager
  const accounts = await em.find(GlAccount, {
    tenantId: context.tenantId,
    organizationId: context.organizationId,
    deletedAt: null,
  })
  return accounts.map((account) => account.code)
}

async function GET(req: Request) {
  try {
    const context = await resolveContext(req)
    const configService = context.container.resolve('moduleConfigService') as ModuleConfigService
    const configured = await readFinancialJurisdiction(configService, {
      tenantId: context.tenantId,
      organizationId: context.organizationId,
    })
    // An explicit query wins so an operator can look at another country's chart
    // before switching; otherwise the answer is the jurisdiction the books are
    // actually kept under.
    const countryCode = resolveCountryCode(
      new URL(req.url).searchParams.get('countryCode') ?? configured,
    )
    const plugin = resolveFinancialCountryPlugin(countryCode)
    const template = plugin.chartOfAccounts
    const accounts = template?.listAccounts() ?? []
    const codes = await existingCodes(context)

    return NextResponse.json({
      countryCode: plugin.countryCode,
      configuredCountryCode: configured,
      isLocalized: !isGenericFinancialCountryPlugin(plugin),
      currencyCode: plugin.tax.currencyCode,
      accountCount: accounts.length,
      missingCodes: template ? missingChartCodes(template, codes) : [],
      accounts,
    })
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    logger.error('financial.chart_of_accounts.GET failed', { err })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

const seedSchema = z.object({
  countryCode: z.string().trim().length(2).optional(),
  currencyCode: z.string().trim().length(3).optional(),
})

async function POST(req: Request) {
  try {
    const context = await resolveContext(req)
    const raw = await readJsonSafe(req, {})
    const input = seedSchema.parse(raw ?? {})
    const plugin = resolveFinancialCountryPlugin(resolveCountryCode(input.countryCode))
    const template = plugin.chartOfAccounts

    if (!template || template.listAccounts().length === 0) {
      const { translate } = await resolveTranslations()
      return NextResponse.json(
        {
          error: translate(
            'financial.errors.chart_template_empty',
            'No chart-of-accounts template is available for this country.',
          ),
          countryCode: plugin.countryCode,
        },
        { status: 409 },
      )
    }

    const em = context.container.resolve('em') as EntityManager
    const result = await seedChartOfAccounts(
      em,
      { tenantId: context.tenantId, organizationId: context.organizationId },
      template,
      {
        currencyCode: input.currencyCode ?? plugin.tax.currencyCode,
        countryCode: isGenericFinancialCountryPlugin(plugin) ? null : plugin.countryCode,
      },
    )

    // Choosing a chart is choosing a jurisdiction, so the choice is recorded here
    // rather than in a second endpoint: it is what tenant setup reads to seed the
    // chart automatically, and what a reader consults to know which tax rules the
    // books follow.
    await writeFinancialJurisdiction(
      context.container.resolve('moduleConfigService') as ModuleConfigService,
      isGenericFinancialCountryPlugin(plugin) ? null : plugin.countryCode,
      { tenantId: context.tenantId, organizationId: context.organizationId },
    )

    return NextResponse.json({ countryCode: plugin.countryCode, ...result })
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    if (err instanceof z.ZodError) {
      const { translate } = await resolveTranslations()
      return NextResponse.json(
        { error: translate('errors.invalid_input', 'Invalid input'), details: err.issues },
        { status: 400 },
      )
    }
    logger.error('financial.chart_of_accounts.POST failed', { err })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

const accountSchema = z.object({
  code: z.string(),
  name: z.string(),
  accountClass: z.enum(['asset', 'liability', 'equity', 'revenue', 'expense']),
  normalBalance: z.enum(['debit', 'credit']),
  accountType: z.string().nullable().optional(),
  parentCode: z.string().nullable().optional(),
})

const getDoc: OpenApiMethodDoc = {
  summary: 'Preview a jurisdiction’s chart of accounts',
  description:
    'Returns the template for the country, with the account codes this organization does not have yet.',
  tags: ['Financial'],
  responses: [
    {
      status: 200,
      description: 'The template and the codes a seed would add',
      schema: z.object({
        countryCode: z.string(),
        /** The jurisdiction the books are actually kept under, or null when unset. */
        configuredCountryCode: z.string().nullable(),
        isLocalized: z.boolean(),
        currencyCode: z.string(),
        accountCount: z.number().int(),
        missingCodes: z.array(z.string()),
        accounts: z.array(accountSchema),
      }),
    },
  ],
}

const postDoc: OpenApiMethodDoc = {
  summary: 'Seed a jurisdiction’s chart of accounts',
  description: 'Idempotent by account code: an account already in the chart keeps its name and its parent.',
  tags: ['Financial'],
  requestBody: { schema: seedSchema },
  responses: [
    {
      status: 200,
      description: 'The codes created and the codes already present',
      schema: z.object({
        countryCode: z.string(),
        created: z.array(z.string()),
        skipped: z.array(z.string()),
        currencyCode: z.string(),
      }),
    },
  ],
  errors: [
    { status: 400, description: 'Invalid body or missing organization scope' },
    { status: 401, description: 'Unauthorized' },
    { status: 409, description: 'No template exists for that country' },
  ],
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Financial',
  summary: 'Chart-of-accounts template and seeding',
  methods: { GET: getDoc, POST: postDoc },
}

export { GET, POST }
