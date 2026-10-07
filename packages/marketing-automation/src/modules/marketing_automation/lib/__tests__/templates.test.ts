import { CAMPAIGN_TEMPLATES, findCampaignTemplate } from '../templates'
import { findUnportableReferences, portableCampaignSchema } from '../portable'
import { getMarketingStep, registerMarketingSteps } from '../engine/registry'
import { builtInSteps } from '../../steps/index'
import { SWEEP_SOURCE_IDS } from '../sweep-sources'
import { findTrigger } from '../trigger-catalog'
import fs from 'node:fs'
import path from 'node:path'

/**
 * The shipped templates, held to exactly the rules an authored campaign is held to.
 *
 * A template is data, and data nobody validates is data that breaks on the day somebody tries to use it — which
 * for a template is its first day, in front of an operator who was told this was the easy path.
 */
registerMarketingSteps(builtInSteps)

const MODULE_ROOT = path.resolve(__dirname, '..', '..')
const en = JSON.parse(fs.readFileSync(path.join(MODULE_ROOT, 'i18n', 'en.json'), 'utf8')) as Record<string, string>

describe('the campaign templates', () => {
  test('there are some, and each has a unique id', () => {
    expect(CAMPAIGN_TEMPLATES.length).toBeGreaterThan(0)
    const ids = CAMPAIGN_TEMPLATES.map((template) => template.id)
    expect(ids).toHaveLength(new Set(ids).size)
  })

  test.each(CAMPAIGN_TEMPLATES.map((template) => [template.id, template] as const))(
    '%s is a valid portable document',
    (_id, template) => {
      // The same schema the import endpoint applies: a template that would be refused on import is worse than
      // no template at all.
      expect(portableCampaignSchema.safeParse(template.document).success).toBe(true)
    },
  )

  test.each(CAMPAIGN_TEMPLATES.map((template) => [template.id, template] as const))(
    '%s uses only step types this module ships, with parameters they accept',
    (_id, template) => {
      const unknown: string[] = []
      /**
       * The params, not only the type.
       *
       * Checking the type alone let two templates ship a `wait` measured in `days` when the step counts
       * MINUTES — they imported, were refused by the save, and the failure only surfaced in an integration run.
       * A template's parameters are as much a part of it as its shape.
       */
      const invalid: string[] = []
      const walk = (steps: typeof template.document.definition.steps): void => {
        for (const step of steps) {
          const handler = getMarketingStep(step.type)
          if (!handler) {
            unknown.push(step.type)
            continue
          }
          if (!handler.paramsSchema.safeParse(step.params ?? {}).success) invalid.push(`${step.id}:${step.type}`)
          const variants = (step.params as { variants?: Array<{ steps?: unknown }> } | undefined)?.variants
          if (Array.isArray(variants)) {
            for (const variant of variants) {
              if (Array.isArray(variant?.steps)) walk(variant.steps as typeof steps)
            }
          }
        }
      }
      walk(template.document.definition.steps)
      expect(unknown).toEqual([])
      expect(invalid).toEqual([])
    },
  )

  test.each(CAMPAIGN_TEMPLATES.map((template) => [template.id, template] as const))(
    '%s references only real triggers and sweep sources',
    (_id, template) => {
      const unknownTriggers: string[] = []
      for (const trigger of template.document.triggers as Array<Record<string, unknown>>) {
        if (trigger.kind === 'event') {
          // An event id nobody subscribes to is a template that saves and never fires.
          if (!findTrigger(String(trigger.eventId))) unknownTriggers.push(String(trigger.eventId))
        } else {
          expect(SWEEP_SOURCE_IDS).toContain(String(trigger.sweepSource))
        }
      }
      expect(unknownTriggers).toEqual([])
    },
  )

  /**
   * The rule that makes a template portable at all.
   *
   * A tag id or a block id inside a shipped template names a row in whatever installation the template was
   * written on. That is exactly what the importer warns about — and a template has no excuse for needing the
   * warning, so it must contain no uuids at all.
   */
  test.each(CAMPAIGN_TEMPLATES.map((template) => [template.id, template] as const))(
    '%s contains no references to another installation',
    (_id, template) => {
      expect(findUnportableReferences(template.document.definition)).toEqual([])
    },
  )

  test.each(CAMPAIGN_TEMPLATES.map((template) => [template.id, template] as const))(
    '%s is described in the locale files',
    (_id, template) => {
      const missing = [template.labelKey, template.descriptionKey, template.requiresKey].filter((key) => !en[key])
      expect(missing).toEqual([])
    },
  )

  /**
   * A win-back audience that omits "has ordered at all" is the module's own documented trap: `daysSinceLast` is
   * ABSENT for a never-buyer, so the condition asks about a key that is not there.
   */
  test('the win-back template asks about customers, not about everybody who registered', () => {
    const template = findCampaignTemplate('win_back')
    const rules = (template?.document.definition.audience as { rules?: Array<{ field?: string }> } | null)?.rules ?? []
    expect(rules.map((rule) => rule.field)).toContain('orders.count')
  })

  test('no template arrives carrying an enabled flag', () => {
    // The format does not even have one — an import that could arrive live would start messaging real customers
    // the moment somebody opened a file.
    for (const template of CAMPAIGN_TEMPLATES) {
      expect(JSON.stringify(template.document)).not.toContain('isEnabled')
    }
  })
})
