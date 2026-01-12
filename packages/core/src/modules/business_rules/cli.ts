import type { ModuleCli } from '@/modules/registry'
import { createRequestContainer } from '@/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import { BusinessRule } from './data/entities'
import * as fs from 'fs'
import * as path from 'path'

/**
 * Parse CLI arguments
 */
function parseArgs(args: string[]) {
  const result: Record<string, string> = {}
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]?.replace(/^-+/, '')
    const value = args[i + 1]
    if (key && value) {
      result[key] = value
    }
  }
  return result
}

/**
 * Seed guard rules for workflow checkout demo
 */
const seedGuardRules: ModuleCli = {
  command: 'seed-guard-rules',
  async run(rest) {
    const args = parseArgs(rest)
    const tenantId = String(args.tenantId ?? args.tenant ?? args.t ?? '')
    const organizationId = String(args.organizationId ?? args.orgId ?? args.org ?? args.o ?? '')

    if (!tenantId || !organizationId) {
      console.error('Usage: mercato business_rules seed-guard-rules --tenant <tenantId> --org <organizationId>')
      console.error('   or: mercato business_rules seed-guard-rules -t <tenantId> -o <organizationId>')
      return
    }

    try {
      const { resolve } = await createRequestContainer()
      const em = resolve<EntityManager>('em')

      // Read guard rules from workflows examples
      const rulesPath = path.join(__dirname, '../workflows/examples', 'guard-rules-example.json')
      const rulesData = JSON.parse(fs.readFileSync(rulesPath, 'utf8'))

      let seededCount = 0
      let skippedCount = 0

      for (const ruleData of rulesData) {
        // Check if rule already exists
        const existing = await em.findOne(BusinessRule, {
          ruleId: ruleData.ruleId,
          tenantId,
          organizationId,
        })

        if (existing) {
          console.log(`  ⊘ Guard rule '${ruleData.ruleId}' already exists`)
          skippedCount++
          continue
        }

        // Create the business rule
        const rule = em.create(BusinessRule, {
          ...ruleData,
          tenantId,
          organizationId,
        })

        await em.persistAndFlush(rule)
        console.log(`  ✓ Seeded guard rule: ${rule.ruleName}`)
        seededCount++
      }

      console.log(`\n✓ Guard rules seeding complete:`)
      console.log(`  - Seeded: ${seededCount}`)
      console.log(`  - Skipped (existing): ${skippedCount}`)
      console.log(`  - Total: ${rulesData.length}`)
    } catch (error) {
      console.error('Error seeding guard rules:', error)
      throw error
    }
  },
}

const businessRulesCliCommands = [
  seedGuardRules,
]

export default businessRulesCliCommands
