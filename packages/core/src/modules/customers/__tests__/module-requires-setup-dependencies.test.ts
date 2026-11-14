import fs from 'node:fs'
import path from 'node:path'

import { metadata } from '../index'

const moduleRoot = path.join(__dirname, '..')

describe('customers module dependencies on dictionaries and feature_toggles', () => {
  // setup.ts imports FeatureToggle from feature_toggles, and ./cli seeds
  // customer/currency dictionaries via Dictionary/DictionaryEntry from
  // dictionaries. Neither was declared in `requires`, so an app enabling
  // `customers` without them generated and migrated cleanly and only failed
  // during tenant setup with "Metadata for entity Dictionary not found"
  // (#7587, same class as #6517/#7444). This test guards the fix: the
  // declaration must stay in sync with the imports it protects.
  it('declares dictionaries and feature_toggles as required modules', () => {
    expect(metadata.requires).toContain('dictionaries')
    expect(metadata.requires).toContain('feature_toggles')
  })

  it('still imports FeatureToggle from feature_toggles in setup.ts', () => {
    const setupSource = fs.readFileSync(path.join(moduleRoot, 'setup.ts'), 'utf8')
    expect(setupSource).toMatch(/from ['"]@open-mercato\/core\/modules\/feature_toggles\/data\/entities['"]/)
  })

  it('still imports Dictionary/DictionaryEntry from dictionaries in cli.ts', () => {
    const cliSource = fs.readFileSync(path.join(moduleRoot, 'cli.ts'), 'utf8')
    expect(cliSource).toMatch(/from ['"]@open-mercato\/core\/modules\/dictionaries\/data\/entities['"]/)
  })
})
