import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

function readSource(relativeUrl: string): string {
  return fs.readFileSync(new URL(relativeUrl, import.meta.url), 'utf8')
}

const mainAppInstrumentation = readSource('../../../../apps/mercato/src/instrumentation.ts')
const templateInstrumentation = readSource('../../template/src/instrumentation.ts')

test('standalone template mirrors the main app instrumentation hook', () => {
  assert.equal(templateInstrumentation, mainAppInstrumentation)
})

test('universal instrumentation keeps JWT startup enforcement Node-only and fail-fast', () => {
  assert.doesNotMatch(mainAppInstrumentation, /^import .*\/auth\/jwt/m)
  assert.match(mainAppInstrumentation, /process\.env\.NEXT_RUNTIME === 'nodejs'/)
  assert.match(mainAppInstrumentation, /process\.env\.NEXT_PHASE !== 'phase-production-build'/)
  assert.match(
    mainAppInstrumentation,
    /await import\('@open-mercato\/shared\/lib\/auth\/jwt'\)/,
  )
  assert.doesNotMatch(mainAppInstrumentation, /process\.(?:stderr|exit)/)
  assert.match(mainAppInstrumentation, /nodeProcess\.stderr\.write/)
  assert.match(mainAppInstrumentation, /nodeProcess\.exit\(1\)/)

  assert.ok(
    mainAppInstrumentation.indexOf('assertJwtSecretPolicy()')
      < mainAppInstrumentation.indexOf('registerTelemetryForNextjs()'),
  )
})
