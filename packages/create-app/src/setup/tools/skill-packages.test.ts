import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CORE_PACKAGE,
  findUnknownPackages,
  parseSkillPackagesInput,
  resolveSkillSelection,
  type SkillPackageManifest,
} from './skill-packages.js'

const MANIFEST: SkillPackageManifest = {
  default: ['core', 'automation'],
  packages: {
    core: { description: 'core', skills: ['om-spec-writing', 'om-help'] },
    automation: { description: 'automation', skills: ['om-auto-create-pr'] },
    creative: {
      description: 'creative',
      skills: ['om-proposal', 'om-brainstorm'],
      extraFiles: ['om-spec-writing/references/proposal-intake.md'],
    },
  },
}

test('resolveSkillSelection always includes core, even when not requested', () => {
  const result = resolveSkillSelection(['automation'], MANIFEST)
  assert.deepEqual(result.packages, ['core', 'automation'])
  assert.ok(result.skills.includes('om-spec-writing'))
  assert.ok(result.skills.includes('om-auto-create-pr'))
})

test('creative selected ships its skills and includes the gated extra file', () => {
  const result = resolveSkillSelection(['creative'], MANIFEST)
  assert.ok(result.skills.includes('om-proposal'))
  assert.ok(result.skills.includes('om-brainstorm'))
  assert.deepEqual(result.includeExtraFiles, ['om-spec-writing/references/proposal-intake.md'])
})

test('creative NOT selected: proposal-intake stays gated and is not included', () => {
  const result = resolveSkillSelection(['automation'], MANIFEST)
  assert.ok(!result.skills.includes('om-proposal'))
  assert.deepEqual(result.includeExtraFiles, [])
  // gatedFiles always lists every package's extraFiles so folder copy skips them.
  assert.ok(result.gatedFiles.includes('om-spec-writing/references/proposal-intake.md'))
})

test('unknown package names are ignored by the resolver', () => {
  const result = resolveSkillSelection(['does-not-exist'], MANIFEST)
  assert.deepEqual(result.packages, ['core'])
})

test('parseSkillPackagesInput trims, lowercases, dedupes, drops empties', () => {
  assert.deepEqual(parseSkillPackagesInput(' Core, creative ,,CREATIVE'), ['core', 'creative'])
  assert.deepEqual(parseSkillPackagesInput(''), [])
})

test('findUnknownPackages reports only undefined names', () => {
  assert.deepEqual(findUnknownPackages(['core', 'nope'], MANIFEST), ['nope'])
  assert.deepEqual(findUnknownPackages(['core', 'creative'], MANIFEST), [])
})

test('CORE_PACKAGE constant matches manifest core key', () => {
  assert.equal(CORE_PACKAGE, 'core')
})
