import fs from 'node:fs'
import path from 'node:path'

import { metadata } from '../index'

const moduleRoot = path.join(__dirname, '..')

describe('workflows module dependency on business_rules', () => {
  // setup.ts resolves the business-rule discovery cache, and lib/seeds.ts
  // imports BusinessRule from business_rules, but the module declared no
  // `requires` field at all. An app enabling `workflows` without
  // `business_rules` generated and migrated cleanly and only failed during
  // tenant setup with "Metadata for entity BusinessRule not found" (#7587,
  // same class as #6517/#7444). This test guards the fix: the declaration
  // must stay in sync with the imports it protects.
  it('declares business_rules as a required module', () => {
    expect(metadata.requires).toContain('business_rules')
  })

  it('still resolves the business-rule discovery cache from business_rules in setup.ts', () => {
    const setupSource = fs.readFileSync(path.join(moduleRoot, 'setup.ts'), 'utf8')
    expect(setupSource).toMatch(/from ['"]@open-mercato\/core\/modules\/business_rules\/lib\/rule-engine['"]/)
  })

  it('still imports BusinessRule from business_rules in lib/seeds.ts', () => {
    const seedsSource = fs.readFileSync(path.join(moduleRoot, 'lib', 'seeds.ts'), 'utf8')
    expect(seedsSource).toMatch(/from ['"]@open-mercato\/core\/modules\/business_rules\/data\/entities['"]/)
  })
})
