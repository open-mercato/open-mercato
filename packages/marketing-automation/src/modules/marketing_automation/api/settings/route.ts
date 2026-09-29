import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { normalizeTierThresholds } from '../../lib/engine/tiers.js'
import { TIER_CONFIG_NAME } from '../../lib/tiers.js'
import { PRODUCT_URL_TEMPLATE_CONFIG } from '../../lib/recommendations.js'
import { BRAND_VOICE_CONFIG } from '../../lib/ai-copy.js'
import { REFERRAL_URL_TEMPLATE_CONFIG } from '../../lib/referrals.js'
import { LEAD_ROUTING_CONFIG } from '../../lib/lead-routing.js'
import { AUTO_APPLY_CONFIG_NAME, AUTO_APPLY_MARGIN_CONFIG_NAME } from '../../lib/auto-winner.js'
import { VALUE_HORIZON_CONFIG_NAME } from '../../lib/value-horizon.js'
import { DEFAULT_WINNER_METRIC, WINNER_METRIC_CONFIG_NAME } from '../../lib/winner-metric.js'
import { DEFAULT_VALUE_HORIZON_YEARS } from '../../lib/engine/rfm.js'
import { DEFAULT_WINNER_MARGIN } from '../../lib/engine/auto-winner.js'

/**
 * The module's per-tenant settings.
 *
 * Two values that were already read by the engine and could not be written by anybody: the loyalty
 * ladder and the product URL template. A setting the code honours but no screen can change is the same
 * defect as a step nothing can author — it looks configurable and is not.
 */
const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['marketing_automation.campaigns.view'] },
  /**
   * `campaigns.manage`, not an invented `marketing_automation.manage`.
   *
   * The id used here was never declared in `acl.ts`, so it could only ever be satisfied by a superadmin or by the
   * `marketing_automation.*` wildcard the seeded admin role happens to hold — a hand-built role could not be
   * granted it at all, because the role editor lists declared features. Fails closed, so nothing was exposed;
   * it was simply a permission nobody could be given on purpose.
   */
  PUT: { requireAuth: true, requireFeatures: ['marketing_automation.campaigns.manage'] },
}

export const metadata = routeMetadata

const MODULE_ID = 'marketing_automation'

const bodySchema = z.object({
  /**
   * Where a product can be looked at. `{sku}` is required, since a template without it would produce
   * the same link for every product — worse than no link, because it looks like it works.
   */
  productUrlTemplate: z.string().trim().max(500).refine(
    (value) => value === '' || value.includes('{sku}'),
    { message: 'must contain {sku}' },
  ).optional(),
  /**
   * How this shop writes, in the operator's own words, handed to the model on every draft.
   *
   * A paragraph rather than a set of toggles: "warm, never pushy, we say 'delivery' not 'shipping'" is
   * something an operator can write and a model can follow, and no enum would have held it.
   */
  brandVoice: z.string().trim().max(1000).optional(),
  /** Where a shared referral link should point. `{code}` is required, for the same reason as the product one. */
  referralUrlTemplate: z.string().trim().max(500).refine(
    (value) => value === '' || value.includes('{code}'),
    { message: 'must contain {code}' },
  ).optional(),
  /**
   * The sales reps new leads are shared between, as user ids.
   *
   * Ids only: a name or an address copied in here would go stale the day somebody changes theirs, and the
   * staff directory already answers both questions from the id.
   */
  leadRoutingUserIds: z.array(z.string().uuid()).max(100).optional(),
  loyaltyTiers: z.array(z.object({
    key: z.string().trim().min(1).max(50),
    minPoints: z.coerce.number().int().min(0),
  })).max(10).optional(),
  /**
   * Whether a decisive A/B result may rewrite the campaign with nobody watching.
   *
   * Off until somebody says otherwise: promoting a winner changes what customers receive, which this module
   * otherwise reserves for a person.
   */
  autoApplySplitWinner: z.boolean().optional(),
  /**
   * How much better the winner must be, as a PROPORTION of the runner-up's click rate.
   *
   * Bounded at 0.05 because below that the margin stops being a guard against noise, and at 5 because a
   * requirement to be six times better is a requirement never to conclude anything.
   */
  autoApplySplitWinnerMargin: z.coerce.number().min(0.05).max(5).optional(),
  /**
   * Whether an A/B test is decided on clicks or on attributed revenue.
   *
   * The same setting governs the suggestion on the results screen and the unattended promotion, because one
   * question answered two ways is how somebody is shown one winner and has a different one applied for them.
   */
  splitWinnerMetric: z.enum(['clicks', 'revenue']).optional(),
  /** How many years a value projection looks ahead. Bounded: a projection is only as good as its cadence. */
  valueHorizonYears: z.coerce.number().min(0.5).max(5).optional(),
})

type ConfigScope = { tenantId?: string | null; organizationId?: string | null }

/**
 * The service's real signature, and the asymmetry is worth naming: `getValue` takes the scope inside an
 * OPTIONS object while `setValue` takes it positionally. Writing per tenant and reading instance-wide is
 * the mistake it invites, and it is silent — the read just returns the default.
 */
type ModuleConfigLike = {
  getValue<T = unknown>(moduleId: string, name: string, options?: { defaultValue?: T | null; scope?: ConfigScope }): Promise<T | null>
  setValue(moduleId: string, name: string, value: unknown, scope?: ConfigScope): Promise<unknown>
}

async function resolve(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const container = await createRequestContainer()
  let service: ModuleConfigLike
  try {
    service = container.resolve<ModuleConfigLike>('moduleConfigService')
  } catch {
    // The engine treats a missing config service as "use the defaults"; a settings screen cannot, so it
    // says so rather than silently accepting a save that goes nowhere.
    return { error: NextResponse.json({ error: 'Configuration service unavailable', code: 'marketing_automation.errors.configUnavailable' }, { status: 503 }) }
  }
  return { service, scope: { tenantId: auth.tenantId, organizationId: auth.orgId } }
}

export async function GET(req: Request) {
  const resolved = await resolve(req)
  if ('error' in resolved) return resolved.error
  const { service, scope } = resolved

  const [template, tiers, brandVoice, referralTemplate, routingPool, autoApply, autoApplyMargin, horizon, winnerMetric] = await Promise.all([
    service.getValue<unknown>(MODULE_ID, PRODUCT_URL_TEMPLATE_CONFIG, { scope }),
    service.getValue<unknown>(MODULE_ID, TIER_CONFIG_NAME, { scope }),
    service.getValue<unknown>(MODULE_ID, BRAND_VOICE_CONFIG, { scope }),
    service.getValue<unknown>(MODULE_ID, REFERRAL_URL_TEMPLATE_CONFIG, { scope }),
    service.getValue<unknown>(MODULE_ID, LEAD_ROUTING_CONFIG, { scope }),
    service.getValue<unknown>(MODULE_ID, AUTO_APPLY_CONFIG_NAME, { scope }),
    service.getValue<unknown>(MODULE_ID, AUTO_APPLY_MARGIN_CONFIG_NAME, { scope }),
    service.getValue<unknown>(MODULE_ID, VALUE_HORIZON_CONFIG_NAME, { scope }),
    service.getValue<unknown>(MODULE_ID, WINNER_METRIC_CONFIG_NAME, { scope }),
  ])

  const readNumber = (value: unknown, fallback: number): number => {
    const parsed = typeof value === 'number' ? value : Number(value)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
  }

  return NextResponse.json({
    productUrlTemplate: typeof template === 'string' ? template : '',
    brandVoice: typeof brandVoice === 'string' ? brandVoice : '',
    referralUrlTemplate: typeof referralTemplate === 'string' ? referralTemplate : '',
    leadRoutingUserIds: Array.isArray(routingPool)
      ? routingPool.filter((entry): entry is string => typeof entry === 'string')
      : [],
    // Normalised on the way out as well as in, so the screen shows the ladder the engine will use
    // rather than whatever shape happens to be stored.
    loyaltyTiers: normalizeTierThresholds(tiers),
    // The defaults are returned rather than nulls, so the screen shows what the engine will actually do.
    autoApplySplitWinner: autoApply === true || autoApply === 'true',
    autoApplySplitWinnerMargin: readNumber(autoApplyMargin, DEFAULT_WINNER_MARGIN),
    valueHorizonYears: readNumber(horizon, DEFAULT_VALUE_HORIZON_YEARS),
    // Anything unrecognised reads as the default rather than being echoed back: the screen offers two choices.
    splitWinnerMetric: winnerMetric === 'revenue' ? 'revenue' : DEFAULT_WINNER_METRIC,
  })
}

export async function PUT(req: Request) {
  const resolved = await resolve(req)
  if ('error' in resolved) return resolved.error
  const { service, scope } = resolved

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return NextResponse.json(
      {
        error: issue ? `${issue.path.join('.') || 'payload'}: ${issue.message}` : 'Invalid payload',
        code: 'marketing_automation.validation.invalidPayload',
      },
      { status: 400 },
    )
  }

  if (parsed.data.productUrlTemplate !== undefined) {
    await service.setValue(MODULE_ID, PRODUCT_URL_TEMPLATE_CONFIG, parsed.data.productUrlTemplate, scope)
  }
  if (parsed.data.brandVoice !== undefined) {
    await service.setValue(MODULE_ID, BRAND_VOICE_CONFIG, parsed.data.brandVoice, scope)
  }
  if (parsed.data.referralUrlTemplate !== undefined) {
    await service.setValue(MODULE_ID, REFERRAL_URL_TEMPLATE_CONFIG, parsed.data.referralUrlTemplate, scope)
  }
  if (parsed.data.leadRoutingUserIds !== undefined) {
    // De-duplicated on the way in: the same rep twice in the pool would halve everybody else's share.
    await service.setValue(MODULE_ID, LEAD_ROUTING_CONFIG, [...new Set(parsed.data.leadRoutingUserIds)], scope)
  }
  if (parsed.data.autoApplySplitWinner !== undefined) {
    await service.setValue(MODULE_ID, AUTO_APPLY_CONFIG_NAME, parsed.data.autoApplySplitWinner, scope)
  }
  if (parsed.data.autoApplySplitWinnerMargin !== undefined) {
    await service.setValue(MODULE_ID, AUTO_APPLY_MARGIN_CONFIG_NAME, parsed.data.autoApplySplitWinnerMargin, scope)
  }
  if (parsed.data.splitWinnerMetric !== undefined) {
    await service.setValue(MODULE_ID, WINNER_METRIC_CONFIG_NAME, parsed.data.splitWinnerMetric, scope)
  }
  if (parsed.data.valueHorizonYears !== undefined) {
    await service.setValue(MODULE_ID, VALUE_HORIZON_CONFIG_NAME, parsed.data.valueHorizonYears, scope)
  }
  if (parsed.data.loyaltyTiers !== undefined) {
    // Stored normalised: the ladder is read on every profile and every tier comparison, and sorting it
    // once here is cheaper than sorting it on every read — and it makes the stored value inspectable.
    await service.setValue(MODULE_ID, TIER_CONFIG_NAME, normalizeTierThresholds(parsed.data.loyaltyTiers), scope)
  }

  return GET(req)
}

export const openApi = {
  GET: {
    summary: 'Read the module settings for the current tenant',
    tags: ['Marketing Automation'],
    responses: { 200: { description: 'Product URL template, brand voice and loyalty ladder' } },
  },
  PUT: {
    summary: 'Update the module settings',
    description: 'Both values were honoured by the engine before this endpoint existed and could not be changed from anywhere.',
    tags: ['Marketing Automation'],
    responses: { 200: { description: 'The stored settings' }, 400: { description: 'Invalid payload' } },
  },
}
