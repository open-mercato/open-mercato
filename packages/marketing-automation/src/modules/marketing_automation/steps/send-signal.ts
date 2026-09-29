import { z } from 'zod'
import type { StepHandler } from '../lib/engine/registry.js'
import type { AutomationContext } from '../lib/engine/types.js'
import { emitMarketingAutomationEvent } from '../events.js'
import { interpolate } from '../lib/interpolate.js'
import type { StepDeps } from './deps.js'

/**
 * Reaches the outside world from inside a journey.
 *
 * **Why this emits an event instead of calling a webhook.** There is no outbound-webhook service in the
 * platform to call — checked rather than assumed. The `webhooks` module subscribes to every declared event and
 * delivers it to whichever endpoints an operator has subscribed, with signing, retries, a delivery log and a
 * queue. A step that emits a declared event therefore reaches any endpoint an operator wants, and a step that
 * did its own HTTP would be a second, worse delivery mechanism sitting inside a worker — which that module's own
 * guidance forbids in as many words.
 *
 * What an operator does: subscribe an endpoint to `marketing_automation.campaign.signal` and filter on `topic`.
 * What an author does: name the topic and add whatever fields the receiver needs.
 */
/**
 * Turns `key=value` lines into a map, and leaves a map alone.
 *
 * Deliberately forgiving about spacing and blank lines, and deliberately strict about the shape: a line without
 * `=` is DROPPED rather than guessed at, because inventing a key for it would put a field the author did not
 * write into somebody's integration. The first `=` splits, so a value may contain more of them — a URL with a
 * query string being the obvious case.
 */
function parseFieldMap(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw
  const map: Record<string, string> = {}
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const separator = trimmed.indexOf('=')
    if (separator <= 0) continue
    const key = trimmed.slice(0, separator).trim()
    if (!key) continue
    map[key] = trimmed.slice(separator + 1).trim()
  }
  return map
}

const paramsSchema = z.object({
  /**
   * The author's name for this signal, which is how one endpoint tells two campaigns apart.
   *
   * Constrained to a slug shape rather than free text: it ends up in somebody's integration code as a
   * comparison, and a topic with a space or a quote in it is a topic that gets mistyped there.
   */
  topic: z.string().min(1).max(64).regex(/^[a-z0-9][a-z0-9._-]*$/, 'a topic is lower-case letters, digits, dots, dashes and underscores'),
  /**
   * Extra fields for the receiver, interpolated like a message body.
   *
   * A flat map of strings on purpose. Nested JSON would invite an author to build a payload shape that the
   * campaign editor cannot validate and the receiver cannot rely on; a flat map is the contract both ends can
   * read, and `{{customer.email}}` already gives it any value the subject document holds.
   *
   * Authored as `key=value` lines, because that is what an author can type into the one field kind the inspector
   * has for multi-line text — and accepted as a map too, so the AI authoring tools and the API can pass the
   * structure directly without formatting it into text first.
   *
   * The definition stores whichever shape it was given, since the platform validates params on save and stores
   * them as written; both shapes normalise here when the step runs, so the receiver's contract is a map either
   * way. Accepting both is what makes that true, which is why this is a `preprocess` rather than a parser at
   * the call site.
   */
  data: z.preprocess(parseFieldMap, z.record(z.string(), z.string())).default({}),
})

/** Enough for a real payload, few enough that a campaign cannot post a document to somebody's endpoint. */
const MAX_FIELDS = 20

export const sendSignalStep: StepHandler<StepDeps> = {
  type: 'send_signal',
  labelKey: 'marketing_automation.step.send_signal.label',
  descriptionKey: 'marketing_automation.step.send_signal.description',
  icon: 'webhook',
  paramsSchema,
  uiFields: [
    { name: 'topic', kind: 'text', labelKey: 'marketing_automation.step.send_signal.param.topic', required: true },
    { name: 'data', kind: 'textarea', labelKey: 'marketing_automation.step.send_signal.param.data' },
  ],
  async execute(ctx: AutomationContext, rawParams, deps: StepDeps) {
    const params = paramsSchema.parse(rawParams)

    const entries = Object.entries(params.data).slice(0, MAX_FIELDS)
    const data: Record<string, string> = {}
    for (const [key, value] of entries) {
      // Interpolated so `{{orders.totalGross}}` reaches the receiver as a number-shaped string rather than as
      // the placeholder, exactly as it would in an email body.
      data[key] = interpolate(value, ctx)
    }

    await emitMarketingAutomationEvent(
      'marketing_automation.campaign.signal',
      {
        topic: params.topic,
        campaignId: ctx.campaignId ?? null,
        runId: ctx.runId ?? null,
        stepId: ctx.actionId ?? null,
        /**
         * The subject's id, and deliberately nothing else about them.
         *
         * This payload leaves the platform for an endpoint the operator chose, so it carries an identifier the
         * receiver can look up rather than a name or an address. An author who genuinely needs the email puts
         * `{{customer.email}}` in `data` themselves, which is a decision they make and can see.
         */
        subjectEntityId: ctx.subjectEntityId ?? null,
        data,
        // Read by the outbound dispatcher off the PAYLOAD, not the emit options: without it the delivery is
        // silently dropped.
        tenantId: deps.scope.tenantId,
        organizationId: deps.scope.organizationId,
      },
      { persistent: true },
    )

    return { status: 'done', detail: `signalled ${params.topic}` }
  },
}
