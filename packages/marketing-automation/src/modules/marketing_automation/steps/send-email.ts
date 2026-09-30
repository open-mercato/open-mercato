import { z } from 'zod'
import { sendEmail } from '@open-mercato/shared/lib/email/send'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CustomerEntity } from '@open-mercato/core/modules/customers/data/entities'
import { reportError } from '@open-mercato/telemetry'
import { interpolate } from '../lib/interpolate.js'
import { loadRenderValues, neededRenderRoots } from '../lib/render-values.js'
import { redactEmails } from '../lib/redact.js'
import { applyContentBlocks, loadContentBlocks, referencedBlockKeys } from '../lib/content-blocks.js'
import {
  applyRecommendations,
  loadProductUrlTemplate,
  recommendForSubject,
  referencesRecommendations,
  renderRecommendationsHtml,
} from '../lib/recommendations.js'
import { applyTracking } from '../lib/tracking/rewrite.js'
import { resolveTrackingBaseUrl, resolveTrackingSecret } from '../lib/tracking/secret.js'
import { clickUrl, openPixelUrl, unsubscribeUrl } from '../lib/tracking/urls.js'
import { MAX_RECOMMENDATIONS } from '../lib/engine/recommendations.js'
import type { StepHandler } from '../lib/engine/registry.js'
import type { AutomationContext } from '../lib/engine/types.js'
import type { StepDeps } from './deps.js'

const paramsSchema = z.object({
  subject: z.string().min(1),
  bodyHtml: z.string().min(1),
  bodyText: z.string().optional(),
  /**
   * Opt out of open and click tracking for this step.
   *
   * Default on, opt-out per step rather than a global switch: a transactional-feeling message inside
   * a campaign is exactly the one an author will want left alone, and that is a decision about one
   * message rather than about the installation.
   */
  track: z.boolean().optional().default(true),
  /**
   * How many products `{{recommendations}}` renders. Ignored when the body does not use it, so the
   * queries are never paid for by a message that would not show them.
   */
  recommendationCount: z.coerce.number().int().min(1).max(MAX_RECOMMENDATIONS).optional(),
})

/** What `{{recommendations}}` renders when the author did not say. Three fits a phone screen. */
export const DEFAULT_RECOMMENDATION_COUNT = 3

/**
 * Rewrites the body so opens and clicks can be attributed, when everything needed is present.
 *
 * Returns the body unchanged whenever it is not — no secret configured, no base URL, no run or step
 * identity, or the author opted out. Tracking is an enhancement to a send; a send must never fail
 * because it could not be tracked.
 */
function withTracking(
  html: string,
  ctx: AutomationContext,
  enabled: boolean,
  /**
   * The unsubscribe URL, which is left exactly as it is.
   *
   * An unsubscribe is not a click. Rewriting it would record one, which inflates every click rate — and
   * because `pickSplitWinner` ranks lanes on click rate, the variant that drove the most unsubscribes would
   * be promoted as the winner. It also broke the footer: once the author's own link had been rewritten, the
   * "did they place it themselves" check could not find it and appended a second one.
   */
  preserveTarget: string | null,
): string {
  if (!enabled) return html
  const secret = resolveTrackingSecret()
  const baseUrl = resolveTrackingBaseUrl()
  if (!secret || !baseUrl) return html
  if (!ctx.runId || !ctx.actionId || !ctx.campaignId) return html

  const claims = {
    tenantId: ctx.tenantId,
    organizationId: ctx.organizationId,
    campaignId: ctx.campaignId,
    runId: ctx.runId,
    stepId: ctx.actionId,
  }
  return applyTracking(html, {
    makeClickUrl: (target) => (preserveTarget && target === preserveTarget ? null : clickUrl(baseUrl, claims, secret, target)),
    pixelUrl: openPixelUrl(baseUrl, claims, secret),
  })
}

/**
 * The unsubscribe link for this message, when one can be built.
 *
 * Null without a run, a secret or a base URL — a test send has no run, and a link that 404s is worse than
 * no link. Exposed to the author as `{{unsubscribeUrl}}` so they can place it where their design wants it.
 */
function unsubscribeLinkFor(ctx: AutomationContext): string | null {
  const secret = resolveTrackingSecret()
  const baseUrl = resolveTrackingBaseUrl()
  if (!secret || !baseUrl) return null
  if (!ctx.runId || !ctx.campaignId) return null
  return unsubscribeUrl(
    baseUrl,
    {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      campaignId: ctx.campaignId,
      runId: ctx.runId,
      stepId: ctx.actionId ?? 'unsubscribe',
    },
    secret,
  )
}

/**
 * Appends an unsubscribe footer when the author did not place the link themselves.
 *
 * A decision worth stating: this MODIFIES the author's HTML, which the rewriter otherwise refuses to do.
 * It happens because a marketing email with no way out is not a shippable default — in much of the world
 * it is not lawful — and an author who wants control has it by using `{{unsubscribeUrl}}` anywhere in the
 * body, which suppresses the footer entirely.
 *
 * Whether the author placed it is decided by the CALLER, on the body before tracking is applied. It used to
 * be decided here, by looking for the URL in the finished HTML — by which point the rewriter had turned the
 * author's link into a tracking URL, so it was never found and every such message went out with two
 * unsubscribe links.
 */
function withUnsubscribeFooter(html: string, url: string | null): string {
  if (!url) return html

  const footer = `<p style="margin-top:2rem;font-size:12px;color:#666">`
    + `<a href="${url.replace(/&/g, '&amp;')}" style="color:#666">Unsubscribe</a>`
    + `</p>`
  const closing = html.lastIndexOf('</body>')
  if (closing === -1) return `${html}${footer}`
  return `${html.slice(0, closing)}${footer}${html.slice(closing)}`
}

/**
 * Resolves the recipient at send time, by reading through the decrypting finder.
 *
 * Deliberately NOT cached in the run context: that context is persisted to jsonb, and
 * `primary_email` is encrypted at rest, so carrying the address there would leave an unencrypted
 * copy of PII in the database. One scoped read per send is the price, and it has a second benefit —
 * a customer who corrects their address mid-journey gets the remaining steps at the new one.
 */
async function resolveRecipient(
  ctx: AutomationContext,
  deps: StepDeps,
): Promise<{ to: string | null; entity: { id: string; displayName?: string | null; primaryEmail?: string | null } | null }> {
  if (!ctx.subjectEntityId) return { to: null, entity: null }

  const entity = await findOneWithDecryption(
    deps.em,
    CustomerEntity,
    {
      id: ctx.subjectEntityId,
      tenantId: deps.scope.tenantId,
      organizationId: deps.scope.organizationId,
      deletedAt: null,
    },
    undefined,
    deps.scope,
  )
  /**
   * The entity travels back, not just the address.
   *
   * It has already been fetched and decrypted here; a message writing `{{customer.displayName}}` would
   * otherwise pay for a second identical read to render the name it is greeting somebody by.
   */
  return { to: entity?.primaryEmail?.trim() || null, entity: entity ?? null }
}

/**
 * Renders the message, once.
 *
 * Exported so a test send renders through the SAME path as a real send. A second renderer would drift,
 * and the whole value of a test send is that what the author sees is what the customer will get.
 *
 * Tracking is applied only when the context carries a run and a step, which a test send does not have —
 * so a test message is deliberately untracked rather than polluting the campaign's engagement figures
 * with the author's own opens.
 */
export function renderEmail(
  params: { subject: string; bodyHtml: string; bodyText?: string; track?: boolean },
  ctx: AutomationContext,
  /**
   * Everything that needed a query, already resolved — content blocks by slug, and the rendered
   * recommendation block. Loaded by the caller because this function stays synchronous, which is what
   * lets a test render exactly what a send renders.
   */
  resolved: {
    blocks?: Record<string, string>
    recommendationsHtml?: string
    /**
     * The customer's own values, resolved at send time.
     *
     * The persisted run context deliberately carries no customer record, so without these the six of eight
     * advertised placeholders that name one could never resolve — and `interpolate` leaves an unresolved
     * placeholder verbatim, which is how the shipped Welcome template came to mail a subject line reading
     * `Welcome, {{customer.displayName}}`. Passed in rather than fetched because this function stays
     * synchronous, which is what lets a test render exactly what a send renders.
     */
    values?: Record<string, unknown>
  } = {},
): { subject: string; html: string; text?: string } {
  const unsubscribe = unsubscribeLinkFor(ctx)
  // The customer's values first, then the run context, so nothing supplied here can shadow the ids and
  // scope the context carries.
  const withValues: AutomationContext = { ...(resolved.values ?? {}), ...ctx } as AutomationContext
  // Offered as a substitution so the author can place it; appended below only if they did not.
  const withUnsubscribeAvailable: AutomationContext = unsubscribe
    ? { ...withValues, unsubscribeUrl: unsubscribe }
    : withValues

  /**
   * Blocks and recommendations first, then interpolation, then tracking.
   *
   * Blocks before interpolation so a shared footer can carry its own placeholders and have them filled;
   * recommendations in the same pass because they are generated HTML, not customer data; interpolation
   * before tracking so every link — including the product links just inserted — is rewritten and therefore
   * attributable. `'html'` is not optional on the interpolation: the body is rendered as HTML, and
   * substituted values can be customer-controlled.
   */
  const interpolated = interpolate(
    applyRecommendations(
      applyContentBlocks(params.bodyHtml, resolved.blocks ?? {}),
      resolved.recommendationsHtml ?? '',
    ),
    withUnsubscribeAvailable,
    'html',
  )

  /**
   * Decided here, before tracking, and this is the whole point.
   *
   * The author places the link by writing `{{unsubscribeUrl}}`, which interpolation has just resolved into
   * the URL — so the body contains it now and will not recognisably contain it a moment later, once the
   * rewriter has wrapped every href in a tracking URL.
   */
  const authorPlacedUnsubscribe = unsubscribe !== null && interpolated.includes(unsubscribe)
  const tracked = withTracking(interpolated, ctx, params.track !== false, unsubscribe)

  return {
    subject: interpolate(params.subject, withValues),
    html: authorPlacedUnsubscribe ? tracked : withUnsubscribeFooter(tracked, unsubscribe),
    text: params.bodyText ? interpolate(params.bodyText, withUnsubscribeAvailable) : undefined,
  }
}

export const sendEmailStep: StepHandler<StepDeps> = {
  type: 'send_email',
  labelKey: 'marketing_automation.step.send_email.label',
  descriptionKey: 'marketing_automation.step.send_email.description',
  icon: 'mail',
  channel: 'email',
  paramsSchema,
  uiFields: [
    { name: 'subject', kind: 'text', labelKey: 'marketing_automation.step.send_email.param.subject', required: true },
    { name: 'bodyHtml', kind: 'textarea', labelKey: 'marketing_automation.step.send_email.param.bodyHtml', required: true },
    { name: 'track', kind: 'boolean', labelKey: 'marketing_automation.step.send_email.param.track' },
    { name: 'recommendationCount', kind: 'number', labelKey: 'marketing_automation.step.send_email.param.recommendationCount' },
  ],
  async execute(ctx: AutomationContext, rawParams, deps: StepDeps) {
    const params = paramsSchema.parse(rawParams)
    // Only the blocks this body actually refers to are loaded.
    const blocks = await loadContentBlocks(deps.em, deps.scope, referencedBlockKeys(params.bodyHtml))
    // Blocks may themselves contain the placeholder, so the check runs over the body WITH them applied.
    const bodyWithBlocks = applyContentBlocks(params.bodyHtml, blocks)
    let recommendationsHtml = ''
    if (referencesRecommendations(bodyWithBlocks)) {
      const [items, urlTemplate] = await Promise.all([
        recommendForSubject(
          deps.em,
          deps.scope,
          ctx.subjectEntityId ?? null,
          params.recommendationCount ?? DEFAULT_RECOMMENDATION_COUNT,
        ),
        loadProductUrlTemplate(deps.container, deps.scope),
      ])
      recommendationsHtml = renderRecommendationsHtml(items, { urlTemplate })
    }
    const { to, entity } = await resolveRecipient(ctx, deps)
    if (!to) {
      // A customer with no address is not an error: plenty of CRM records have none, and
      // failing the run would retry five times and then dead-letter a journey that can never
      // succeed.
      return { status: 'skipped', detail: 'no email address on the subject' }
    }

    /**
     * Loaded by what the copy ASKS for.
     *
     * Most messages name the customer and nothing else, and the name arrived with the address lookup above,
     * so the common case costs no extra query. A message quoting somebody's order count or loyalty tier pays
     * for exactly that and nothing more.
     */
    const values = await loadRenderValues(
      deps.em,
      deps.container,
      ctx,
      deps.scope,
      neededRenderRoots([params.subject, params.bodyHtml, params.bodyText]),
      entity,
      deps.now ?? new Date(),
    )

    try {
      await sendEmail({
        to,
        ...renderEmail(params, ctx, { blocks, recommendationsHtml, values }),
        tenantId: deps.scope.tenantId,
        organizationId: deps.scope.organizationId,
      })
    } catch (error) {
      /**
       * The transport's own text never leaves this function.
       *
       * A rejection quotes the address it rejected — `550 5.1.1 <someone@example.com>` — and the
       * caller writes whatever it catches into `last_error` and the step log, which the runs API
       * returns to anybody holding `runs.view` alone. The full message goes to the structured log and
       * the error reporter, which are a different trust boundary; what propagates is a redacted
       * summary. `redactEmails` is applied as well as the rewrite, because a transport may quote the
       * address in a shape the prefix below does not anticipate.
       */
      const original = error instanceof Error ? error.message : String(error)
      deps.logger.error('[internal] marketing email transport rejected the send', {
        campaignId: ctx.campaignId,
        runId: ctx.runId,
        stepId: ctx.actionId,
        error: original,
      })
      reportError(error, {
        module: 'marketing_automation',
        code: 'marketing_automation.email_transport_failed',
        attributes: { campaignId: ctx.campaignId ?? undefined, stepId: ctx.actionId ?? undefined },
      })
      throw new Error(`[internal] email transport rejected the send: ${redactEmails(original)}`)
    }

    // The address is intentionally not returned: it must not reach the send history.
    return { status: 'done', detail: 'email sent' }
  },
}
