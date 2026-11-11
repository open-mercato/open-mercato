import { z } from 'zod'
import { campaignDefinitionSchema } from '../data/validators.js'

/**
 * A campaign as a portable document, which it very nearly already was.
 *
 * The authored graph lives in one jsonb column and the triggers are a handful of rows, so "export a campaign"
 * needs no new representation — the definition IS the contract. That is the whole reason this is cheap, and it is
 * also why the format carries a version: the day the definition shape changes, an old file has to be recognisable
 * as old rather than merely invalid.
 *
 * Deliberately NOT carried: ids, timestamps, the enabled flag, the tenant. An exported campaign is a description
 * of intent, not a copy of a record — and an import that restored the enabled flag would start messaging real
 * customers the moment somebody opened a file.
 */

export const PORTABLE_FORMAT_VERSION = 1

export const portableCampaignSchema = z.object({
  formatVersion: z.literal(PORTABLE_FORMAT_VERSION),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).nullable().optional(),
  definition: campaignDefinitionSchema,
  triggers: z.array(z.record(z.string(), z.unknown())).max(20),
})

export type PortableCampaign = z.infer<typeof portableCampaignSchema>

/** Anything uuid-shaped, which between two installations means "a reference that cannot travel". */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Step parameters that point at something only the source installation has.
 *
 * A campaign can be moved between installations except for one class of thing: a step whose parameter is a tag
 * id, a content-block id or any other uuid names a row that exists over THERE. Rather than guessing which
 * parameter means what — which would need this function to know every step type, now and in future — the rule is
 * structural: a uuid-shaped value is a reference, and a reference is reported.
 *
 * Reported rather than stripped, and the campaign is imported anyway but disabled: an author can see "this step
 * points at a tag from the other shop, pick one here", which is a five-second fix. Silently dropping the
 * parameter would leave a step that looks configured and does nothing.
 */
export function findUnportableReferences(definition: PortableCampaign['definition']): Array<{ stepId: string; param: string }> {
  const found: Array<{ stepId: string; param: string }> = []

  const walk = (steps: PortableCampaign['definition']['steps'], depth: number): void => {
    if (depth > 5) return
    for (const step of steps) {
      for (const [key, value] of Object.entries(step.params ?? {})) {
        if (typeof value === 'string' && UUID_PATTERN.test(value)) {
          found.push({ stepId: step.id, param: key })
        }
      }
      /**
       * Into a split's lanes as well.
       *
       * The module has learned this one the hard way: a validation that walks only the trunk let a campaign hide
       * a self-driving cycle inside a lane. A warning that stops at the trunk would hide a broken reference in
       * exactly the same place.
       */
      const variants = (step.params as { variants?: Array<{ steps?: unknown }> } | undefined)?.variants
      if (Array.isArray(variants)) {
        for (const variant of variants) {
          if (Array.isArray(variant?.steps)) {
            walk(variant.steps as PortableCampaign['definition']['steps'], depth + 1)
          }
        }
      }
    }
  }

  walk(definition.steps, 0)
  return found
}
