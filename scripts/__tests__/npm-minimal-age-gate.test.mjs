import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { parse } from 'yaml'

const rootYarnrcPath = path.resolve('.yarnrc.yml')
const templateYarnrcPath = path.resolve('packages/create-app/template/.yarnrc.yml.template')
const retryScriptPath = path.resolve('scripts/ci/npm-retry-on-quarantine.sh')
const dependabotConfigPath = path.resolve('.github/dependabot.yml')

const AGREED_MINIMAL_AGE_GATE = '5d'

const DURATION_UNIT_IN_DAYS = { m: 1 / 1440, h: 1 / 24, d: 1, w: 7 }

const COOLDOWN_DAY_KEYS = ['default-days', 'semver-major-days', 'semver-minor-days', 'semver-patch-days']

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8')
}

function readMinimalAgeGate(filePath) {
  return readText(filePath).match(/^npmMinimalAgeGate:\s*(\S+)$/m)?.[1]
}

function durationToDays(duration) {
  const parsed = String(duration).match(/^(\d+)([mhdw])$/)

  assert.ok(
    parsed,
    `cannot read "${duration}" as a yarn duration — teach durationToDays the new unit before changing npmMinimalAgeGate, otherwise this guard silently stops comparing`
  )

  return Number(parsed[1]) * DURATION_UNIT_IN_DAYS[parsed[2]]
}

function readDependabotEcosystem(ecosystem) {
  const config = parse(readText(dependabotConfigPath))
  const entry = config.updates?.find((update) => update['package-ecosystem'] === ecosystem)

  assert.ok(entry, `.github/dependabot.yml must keep an updates entry for the "${ecosystem}" ecosystem`)

  return entry
}

test('the monorepo and scaffolded apps quarantine third-party releases for the agreed duration', () => {
  const root = readMinimalAgeGate(rootYarnrcPath)
  const template = readMinimalAgeGate(templateYarnrcPath)

  assert.equal(
    root,
    AGREED_MINIMAL_AGE_GATE,
    '.yarnrc.yml must keep the release-age quarantine agreed in .ai/specs/briefs/2026-08-09-dependabot-cooldown-ci-gate.md — yarn defaults to 1d, which is shorter than the detection time of several known supply-chain incidents'
  )
  assert.equal(
    template,
    root,
    'packages/create-app/template/.yarnrc.yml.template must declare the same npmMinimalAgeGate as the monorepo, otherwise scaffolded apps silently fall back to yarn\'s 1d default'
  )
})

test('dependabot holds npm updates back at least as long as the yarn release-age gate', () => {
  const gateDays = durationToDays(AGREED_MINIMAL_AGE_GATE)
  const cooldown = readDependabotEcosystem('npm').cooldown

  assert.ok(
    cooldown,
    'the npm entry in .github/dependabot.yml must declare a cooldown — without one Dependabot proposes versions younger than npmMinimalAgeGate, and those PRs cannot install (`yarn install` fails with YN0016 ... quarantined until the version ages out)'
  )

  const declaredKeys = COOLDOWN_DAY_KEYS.filter((key) => cooldown[key] !== undefined)

  assert.ok(
    declaredKeys.includes('default-days'),
    'the npm cooldown must set default-days — dependabot falls back to its own 3-day default for every bump type left unspecified, which is shorter than npmMinimalAgeGate'
  )

  for (const key of declaredKeys) {
    assert.ok(
      cooldown[key] >= gateDays,
      `the npm cooldown ${key} (${cooldown[key]}) must be at least npmMinimalAgeGate from .yarnrc.yml (${AGREED_MINIMAL_AGE_GATE}); a shorter window lets dependabot open update PRs that yarn refuses to resolve`
    )
  }
})

test('dependabot applies a release-age cooldown to github actions as well', () => {
  const cooldown = readDependabotEcosystem('github-actions').cooldown

  assert.ok(
    cooldown?.['default-days'] >= 1,
    'the github-actions entry in .github/dependabot.yml must declare a cooldown default-days — actions sit outside yarn\'s dependency graph, so this cooldown is the only release-age defence on that supply chain'
  )
})

test('scaffolded apps preapprove the first-party scope against yarn minimum release age', () => {
  const template = readText(templateYarnrcPath)

  assert.match(
    template,
    /^npmPreapprovedPackages:\n(?:\s+- .*\n)*\s+- "@open-mercato\/\*"$/m,
    'template/.yarnrc.yml.template must preapprove "@open-mercato/*" — yarn refuses versions younger than npmMinimalAgeGate (default 1d), and scaffolded apps pin the release they were scaffolded from'
  )

  const preapprovalIndex = template.indexOf('npmPreapprovedPackages:')
  const registryConfigIndex = template.indexOf('{{REGISTRY_CONFIG}}')

  assert.ok(
    preapprovalIndex >= 0 && registryConfigIndex > preapprovalIndex,
    'npmPreapprovedPackages must stay at the top level, before the {{REGISTRY_CONFIG}} block, so it is not parsed as part of npmScopes'
  )
})

test('the quarantine retry helper fails fast on yarn minimum release age gates', () => {
  const script = readText(retryScriptPath)

  assert.match(
    script,
    /grep -qE 'YN0016\.\*quarantined'/,
    'npm-retry-on-quarantine.sh must detect yarn YN0016 age-gate failures separately from npm registry quarantine'
  )
  assert.match(
    script,
    /npmPreapprovedPackages/,
    'the YN0016 branch must point at the npmPreapprovedPackages fix instead of retrying for 20 minutes'
  )

  const yn0016Index = script.indexOf("grep -qE 'YN0016")
  const genericQuarantineIndex = script.indexOf("grep -qiE 'quarantin'")

  assert.ok(
    yn0016Index >= 0 && genericQuarantineIndex > yn0016Index,
    'the YN0016 fast-fail must run before the generic quarantine retry branch'
  )
})
