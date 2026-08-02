import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const templateYarnrcPath = path.resolve('packages/create-app/template/.yarnrc.yml.template')
const retryScriptPath = path.resolve('scripts/ci/npm-retry-on-quarantine.sh')

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8')
}

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
