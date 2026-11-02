import fs from 'node:fs'
import path from 'node:path'

import { metadata } from '../index'

const moduleRoot = path.join(__dirname, '..')

describe('portal module dependency on feature_toggles', () => {
  // setup.ts imports FeatureToggle from feature_toggles to seed the
  // `portal_enabled` toggle, but the module never declared it in `requires`.
  // An app enabling `portal` without `feature_toggles` generated and
  // migrated cleanly and only failed during tenant setup with
  // "Metadata for entity FeatureToggle not found" (#7587, same class as
  // #6517/#7444). This test guards the fix: the declaration must stay in
  // sync with the import it protects.
  it('declares feature_toggles as a required module', () => {
    expect(metadata.requires).toContain('feature_toggles')
  })

  it('still imports FeatureToggle from feature_toggles in setup.ts', () => {
    const setupSource = fs.readFileSync(path.join(moduleRoot, 'setup.ts'), 'utf8')
    expect(setupSource).toMatch(/from ['"]@open-mercato\/core\/modules\/feature_toggles\/data\/entities['"]/)
  })
})
