import { PORTABLE_FORMAT_VERSION } from './portable.js'
import type { PortableCampaign } from './portable.js'

/**
 * Ready-made campaigns, in the same format an export produces.
 *
 * The gap these close is the one the setup checklist names: the difference between an installed module and a used
 * one. An operator who opens an empty canvas has to know what a good campaign looks like before they can build
 * one; an operator who opens a welcome sequence has to decide whether they agree with it, which is a far easier
 * question.
 *
 * **They are data, not code.** Each is a document the ordinary import path creates a campaign from, so every
 * save-time rule validates them and a template cannot be in a state an authored campaign could not be in. A test
 * pushes each one through the real schema.
 *
 * **No uuids anywhere**, and a test asserts it. A template with a tag id in it would carry a reference to a row
 * in whatever installation the template was written on — which is the same thing the import warns about, and a
 * shipped template has no excuse for needing the warning.
 *
 * Every one arrives DISABLED, with copy an operator is expected to rewrite. The copy is deliberately plain rather
 * than clever: a template that sounds like marketing somebody else wrote gets deleted, while one that sounds like
 * a first draft gets edited.
 */

export type CampaignTemplate = {
  /** Stable id, referenced by the UI and by the instantiate call. */
  id: string
  labelKey: string
  descriptionKey: string
  /** What an operator needs in place for this to do anything — shown before they instantiate it. */
  requiresKey: string
  document: PortableCampaign
}

const welcome: CampaignTemplate = {
  id: 'welcome',
  labelKey: 'marketing_automation.template.welcome.label',
  descriptionKey: 'marketing_automation.template.welcome.description',
  requiresKey: 'marketing_automation.template.requires.emailChannel',
  document: {
    formatVersion: PORTABLE_FORMAT_VERSION,
    name: 'Welcome',
    description: 'Greets a new customer, then follows up two days later.',
    definition: {
      version: 1,
      audience: null,
      steps: [
        {
          id: 'welcome-email',
          type: 'send_email',
          params: {
            subject: 'Welcome, {{customer.displayName}}',
            bodyHtml: '<p>Thanks for signing up. Here is what we are about, and how to reach a person if you need one.</p>',
          },
        },
        // Waits are counted in MINUTES, which is the engine's unit — two days.
        { id: 'welcome-wait', type: 'wait', params: { minutes: 2880 } },
        {
          id: 'welcome-followup',
          type: 'send_email',
          params: {
            subject: 'Anything we can help with?',
            bodyHtml: '<p>You signed up a couple of days ago. If you were looking for something specific, reply to this and a person will read it.</p>',
          },
        },
      ],
    },
    triggers: [{ kind: 'event', eventId: 'customers.person.created' }],
  },
}

const winBack: CampaignTemplate = {
  id: 'win_back',
  labelKey: 'marketing_automation.template.winBack.label',
  descriptionKey: 'marketing_automation.template.winBack.description',
  requiresKey: 'marketing_automation.template.requires.emailChannel',
  document: {
    formatVersion: PORTABLE_FORMAT_VERSION,
    name: 'Win back',
    description: 'Reaches customers who have bought before and not for a while.',
    definition: {
      version: 1,
      /**
       * `orders.count >= 1` is not decoration.
       *
       * Without it, `daysSinceLast` is ABSENT for somebody who never ordered, and the audience would be asking a
       * question about a key that is not there. It also states the intent: this campaign is for lapsed CUSTOMERS,
       * not for everybody who ever registered.
       */
      audience: {
        operator: 'AND',
        rules: [
          { field: 'orders.count', operator: '>=', value: 1 },
          { field: 'orders.daysSinceLast', operator: '>=', value: 90 },
        ],
      },
      steps: [
        {
          id: 'win-back-email',
          type: 'send_email',
          params: {
            subject: 'It has been a while',
            bodyHtml: '<p>You bought from us a few months ago. Here is what has changed since, and what we still have.</p>{{recommendations}}',
          },
        },
      ],
    },
    triggers: [{ kind: 'schedule', scheduleValue: '1d', sweepSource: 'customers', sweepParams: {}, reentryAfterDays: 180 }],
  },
}

const reviewRequest: CampaignTemplate = {
  id: 'review_request',
  labelKey: 'marketing_automation.template.reviewRequest.label',
  descriptionKey: 'marketing_automation.template.reviewRequest.description',
  requiresKey: 'marketing_automation.template.requires.emailChannel',
  document: {
    formatVersion: PORTABLE_FORMAT_VERSION,
    name: 'Review request',
    description: 'Asks for a review a week after an order was delivered.',
    definition: {
      version: 1,
      audience: null,
      steps: [
        {
          id: 'review-email',
          type: 'send_email',
          params: {
            subject: 'How was order {{trigger.orderNumber}}?',
            bodyHtml: '<p>Your order arrived about a week ago. If you have two minutes, telling other people what you thought helps more than anything we could write ourselves.</p>',
          },
        },
      ],
    },
    triggers: [{ kind: 'schedule', scheduleValue: '1d', sweepSource: 'fulfilled_orders', sweepParams: { withinDays: 7 }, reentryAfterDays: null }],
  },
}

const npsFollowUp: CampaignTemplate = {
  id: 'nps_follow_up',
  labelKey: 'marketing_automation.template.nps.label',
  descriptionKey: 'marketing_automation.template.nps.description',
  requiresKey: 'marketing_automation.template.requires.emailChannel',
  document: {
    formatVersion: PORTABLE_FORMAT_VERSION,
    name: 'Satisfaction check',
    description: 'Asks how likely somebody is to recommend the shop, and tells a person when the answer is poor.',
    definition: {
      version: 1,
      audience: { operator: 'AND', rules: [{ field: 'orders.count', operator: '>=', value: 1 }] },
      steps: [
        {
          id: 'nps-ask',
          type: 'nps_survey',
          params: {
            subject: 'One question, no form',
            question: 'How likely are you to recommend us to somebody you know?',
          },
        },
        { id: 'nps-wait', type: 'wait', params: { minutes: 4320 } },
        {
          id: 'nps-escalate',
          type: 'notify',
          params: {
            audience: 'owner',
            /**
             * The step decides who to tell; this sentence is what they read. Written to be actionable rather
             * than informative, because a notification nobody acts on trains people to ignore the next one.
             */
            message: '{{customer.displayName}} answered {{survey.nps}} out of 10. Worth a call.',
            severity: 'warning',
          },
        },
      ],
    },
    triggers: [{ kind: 'schedule', scheduleValue: '1d', sweepSource: 'customers', sweepParams: {}, reentryAfterDays: 365 }],
  },
}

const reorder: CampaignTemplate = {
  id: 'reorder',
  labelKey: 'marketing_automation.template.reorder.label',
  descriptionKey: 'marketing_automation.template.reorder.description',
  requiresKey: 'marketing_automation.template.requires.repeatPurchases',
  document: {
    formatVersion: PORTABLE_FORMAT_VERSION,
    name: 'Time to reorder',
    description: 'Reminds a customer when something they buy regularly is due.',
    definition: {
      version: 1,
      audience: null,
      steps: [
        {
          id: 'reorder-email',
          type: 'send_email',
          params: {
            subject: 'Running low on {{trigger.sku}}?',
            // The cycle in the copy is what makes this feel observed rather than guessed.
            bodyHtml: '<p>You usually buy this about every {{trigger.cycleDays}} days, and it has been {{trigger.daysSinceLast}}. Here it is again if you need it.</p>',
          },
        },
      ],
    },
    triggers: [{ kind: 'schedule', scheduleValue: '1d', sweepSource: 'reorder_due', sweepParams: { withinDays: 10 }, reentryAfterDays: null }],
  },
}

const birthday: CampaignTemplate = {
  id: 'birthday',
  labelKey: 'marketing_automation.template.birthday.label',
  descriptionKey: 'marketing_automation.template.birthday.description',
  requiresKey: 'marketing_automation.template.requires.birthDate',
  document: {
    formatVersion: PORTABLE_FORMAT_VERSION,
    name: 'Birthday',
    description: 'Sends a greeting on the day, once a year.',
    definition: {
      version: 1,
      audience: null,
      steps: [
        {
          id: 'birthday-email',
          type: 'send_email',
          params: {
            subject: 'Happy birthday, {{customer.displayName}}',
            bodyHtml: '<p>Have a good one from all of us.</p>',
          },
        },
      ],
    },
    triggers: [{ kind: 'schedule', scheduleValue: '1d', sweepSource: 'birthdays', sweepParams: { withinDays: 0 }, reentryAfterDays: null }],
  },
}

export const CAMPAIGN_TEMPLATES: CampaignTemplate[] = [
  welcome,
  winBack,
  reviewRequest,
  npsFollowUp,
  reorder,
  birthday,
]

export function findCampaignTemplate(id: string): CampaignTemplate | undefined {
  return CAMPAIGN_TEMPLATES.find((template) => template.id === id)
}

/**
 * Step parameters that hold words a customer reads, per step type.
 *
 * Listed rather than inferred: a step's params are an open record, so substituting every string in them would
 * eventually translate a sku, a tag name or a template placeholder. These five are the copy.
 */
const TRANSLATABLE_PARAMS: Record<string, readonly string[]> = {
  send_email: ['subject', 'bodyHtml'],
  nps_survey: ['subject', 'question'],
  notify: ['message'],
}

/** `marketing_automation.template.welcome.copy.welcome-email.subject` and friends. */
function copyKey(templateId: string, ...parts: string[]): string {
  return `marketing_automation.template.${templateId}.copy.${parts.join('.')}`
}

/**
 * The same template with its customer-facing words in the reader's language.
 *
 * The documents carry English literals because they are portable documents first — an export of one has to be
 * importable anywhere, and a dictionary key in a `subject` would arrive at the other installation as the literal
 * string `marketing_automation.…`. So the English stays in the document and a translation is layered over it
 * here, keyed by template and step id, with the literal as the fallback. A locale that has not been written yet
 * therefore yields the English template rather than an empty subject line.
 *
 * Pure on purpose: it takes the translate function rather than importing one, so it stays testable and usable
 * from either side of the request.
 */
export function localizeCampaignTemplate(
  template: CampaignTemplate,
  translate: (key: string, fallback: string) => string,
): CampaignTemplate {
  const document = template.document
  const localizeSteps = (steps: PortableCampaign['definition']['steps'], depth: number): PortableCampaign['definition']['steps'] => {
    if (depth > 5) return steps
    return steps.map((step) => {
      const fields = TRANSLATABLE_PARAMS[step.type as string]
      const params = step.params as Record<string, unknown> | undefined
      let nextParams = params
      if (fields && params) {
        nextParams = { ...params }
        for (const field of fields) {
          const current = params[field]
          if (typeof current !== 'string' || current.length === 0) continue
          nextParams[field] = translate(copyKey(template.id, String(step.id), field), current)
        }
      }
      const variants = (step as { variants?: Array<{ steps?: PortableCampaign['definition']['steps'] }> }).variants
      const nextVariants = Array.isArray(variants)
        ? variants.map((variant) => (
          Array.isArray(variant.steps) ? { ...variant, steps: localizeSteps(variant.steps, depth + 1) } : variant
        ))
        : undefined
      return {
        ...step,
        ...(nextParams ? { params: nextParams } : {}),
        ...(nextVariants ? { variants: nextVariants } : {}),
      } as typeof step
    })
  }

  return {
    ...template,
    document: {
      ...document,
      name: translate(copyKey(template.id, 'name'), document.name),
      description: document.description
        ? translate(copyKey(template.id, 'description'), document.description)
        : document.description,
      definition: { ...document.definition, steps: localizeSteps(document.definition.steps, 0) },
    },
  }
}
