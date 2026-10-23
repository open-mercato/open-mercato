import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

const here = import.meta.dirname
const root = path.resolve(here, '..', '..')

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

test('dev splash html stays synced with create-app template copy', () => {
  assert.equal(
    read('scripts/dev-splash.html'),
    read('packages/create-app/template/scripts/dev-splash.html'),
  )
})

test('dev splash keeps stabilized stream layout and explicit locale picker', () => {
  const source = read('scripts/dev-splash.html')

  assert.match(source, /\.stream-shell\s*{[^}]*height:\s*100%;/s)
  assert.match(source, /\.hero-body\s*{[^}]*align-content:\s*start;/s)
  assert.match(source, /if \(overflowing\) {\s*activityList\.scrollTop = activityList\.scrollHeight\s*}/s)
  assert.match(source, /<select class="locale-select" id="locale-select" aria-label="Language"><\/select>/)
})

test('dev splash recognizes greenfield, setup, and ephemeral mode labels', () => {
  const source = read('scripts/dev-splash.html')

  assert.match(source, /modeGreenfield:/)
  assert.match(source, /modeSetup:/)
  assert.match(source, /modeEphemeral:/)
  assert.match(source, /if \(mode === 'greenfield'\) return t\('modeGreenfield'\)/)
  assert.match(source, /if \(mode === 'setup'\) return t\('modeSetup'\)/)
  assert.match(source, /if \(mode === 'ephemeral'\) return t\('modeEphemeral'\)/)
})

test('dev splash renders a structured runtime incident preview', () => {
  const source = read('scripts/dev-splash.html')

  assert.match(source, /<section class="incident-box" id="incident-box" hidden>/)
  assert.match(source, /id="incident-badge"/)
  assert.match(source, /id="incident-title"/)
  assert.match(source, /id="incident-detail"/)
  assert.match(source, /id="incident-meta"/)
  assert.match(source, /id="incident-hint"/)
  assert.match(source, /function renderIncident\(state\) {/)
  assert.match(source, /renderIncident\(state\)\s*\n\s*renderFailure\(state\)/)
})

test('dev splash ignores an incident left behind by an older generation', () => {
  const source = read('scripts/dev-splash.html')

  assert.match(source, /if \(summary\.generation !== runtime\.generation\) return null/)
})

test('dev splash keeps showing the log tail for a post-ready incident', () => {
  const source = read('scripts/dev-splash.html')

  assert.match(source, /\|\| \(incident !== null && lines\.length > 0\)/)
})

test('dev splash localizes every incident label in all supported locales', () => {
  const source = read('scripts/dev-splash.html')
  const requiredKeys = [
    'incidentHealth_starting',
    'incidentHealth_degraded',
    'incidentHealth_recovering',
    'incidentHealth_unavailable',
    'incidentCode',
    'incidentSource',
    'incidentOccurrences',
    'incidentLastSeen',
    'incidentPath',
    'incidentRecovery_generate',
    'incidentRecovery_migrate',
    'incidentRecovery_restart',
  ]

  for (const key of requiredKeys) {
    const occurrences = source.split(`${key}:`).length - 1
    assert.equal(occurrences, 4, `${key} must be translated for all four splash locales`)
  }
})

test('dev splash warns that the migrate recovery is not automatically reversible', () => {
  const source = read('scripts/dev-splash.html')

  assert.match(source, /incidentRecovery_migrate: 'Suggested fix: apply database migrations[^']*not automatically reversible\.'/)
})

test('dev splash requires a second explicit click before applying migrations', () => {
  const source = read('scripts/dev-splash.html')

  assert.match(source, /if \(action === 'migrate' && pendingConfirmAction !== 'migrate'\) \{/)
  assert.match(source, /incidentActionMigrateWarning:/)
  // The static splash must not fall back to a native confirm dialog.
  assert.doesNotMatch(source, /window\.confirm|[^.\w]confirm\(/)
})

test('dev splash posts recovery actions to the fixed allowlist with the run token', () => {
  const source = read('scripts/dev-splash.html')

  assert.match(source, /fetch\('\/runtime\/actions\/' \+ encodeURIComponent\(action\)/)
  assert.match(source, /'x-om-dev-runtime-token': splashBootstrap\.runtimeToken/)
  assert.match(source, /if \(!splashBootstrap\.runtimeToken\) return \[\]/)
})

test('dev splash hides recovery controls while an action is already running', () => {
  const source = read('scripts/dev-splash.html')

  assert.match(source, /const busy = state\?\.runtime\?\.recovery\?\.busy === true/)
  assert.match(source, /incidentActionStatus\.textContent = t\('incidentActionBusy'\)\s*\n\s*return/)
})

test('dev splash localizes every recovery action label in all supported locales', () => {
  const source = read('scripts/dev-splash.html')
  const requiredKeys = [
    'incidentAction_generate',
    'incidentAction_migrate',
    'incidentAction_restart',
    'incidentActionConfirm_migrate',
    'incidentActionCancel',
    'incidentActionMigrateWarning',
    'incidentActionStarting',
    'incidentActionAccepted',
    'incidentActionBusy',
    'incidentActionFailed',
  ]

  for (const key of requiredKeys) {
    const occurrences = source.split(`${key}:`).length - 1
    assert.equal(occurrences, 4, `${key} must be translated for all four splash locales`)
  }
})

test('ephemeral dev runner publishes an explicit splash mode', () => {
  const source = read('scripts/dev-ephemeral.ts')

  assert.match(source, /const splashState = {\s*mode: 'ephemeral',/s)
})

function extractFunctionSource(source, name) {
  const start = source.indexOf(`      function ${name}(`)
  assert.notEqual(start, -1, `${name} must exist in the splash`)
  const end = source.indexOf('\n      }\n', start)
  return source.slice(start, end + '\n      }\n'.length)
}

function createBuildingHarness() {
  const source = read('scripts/dev-splash.html')
  const element = () => ({
    hidden: true,
    disabled: false,
    textContent: '',
    title: '',
    dataset: {},
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = value },
  })
  const context = {
    buildingShell: element(),
    buildingButton: element(),
    buildingStatus: element(),
    buildingActionInFlight: false,
    splashBootstrap: { codingFlow: { enabled: true, actionToken: 'token' } },
    translations: {
      en: {
        buildingButtonLabel: 'Start building',
        buildingTitle: 'Open Cezar ({command})',
        buildingResult_started: 'Started {command}',
        buildingResult_npx_missing: 'npx missing, run {command}',
        buildingResult_failed: 'Failed, run {command}',
      },
    },
    translateMessage: (value) => value,
  }
  context.t = (key, vars = {}) => String(context.translations.en[key] || key)
    .replace(/\{(\w+)\}/g, (_match, name) => String(vars[name] ?? ''))
  vm.createContext(context)
  vm.runInContext(
    extractFunctionSource(source, 'translateBuildingResult') + extractFunctionSource(source, 'renderBuildingFlow'),
    context,
  )
  return context
}

test('dev splash renders the Start building button inside the shared status card', () => {
  const source = read('scripts/dev-splash.html')

  assert.match(source, /<div class="building-shell" id="building-shell" hidden>/)
  assert.match(source, /<button class="button secondary building-button" id="building-button" type="button">/)
  assert.match(source, /id="building-status" role="status" aria-live="polite" hidden/)
  assert.match(source, /renderBuildingFlow\(state\)\s*\n\s*renderCodingFlow\(state\)/)
})

test('dev splash posts Start building without any command, path, or URL', () => {
  const source = read('scripts/dev-splash.html')
  const startBuilding = source.slice(source.indexOf('async function startBuilding()'), source.indexOf('function translateBuildingResult'))

  assert.match(startBuilding, /fetch\('\/actions\/start-building', {/)
  assert.match(startBuilding, /'x-om-dev-splash-token': codingBootstrap\.actionToken \|\| ''/)
  assert.match(startBuilding, /body: '\{\}',/)
  assert.match(startBuilding, /if \(buildingActionInFlight\) return/)
})

test('dev splash shows Start building while the app is still starting', () => {
  const harness = createBuildingHarness()
  harness.renderBuildingFlow({
    ready: false,
    failed: false,
    codingFlow: {
      enabled: true,
      busy: false,
      building: { available: true, reason: null, manualCommand: 'npx cezar-run', lastResult: null },
    },
  })

  assert.equal(harness.buildingShell.hidden, false)
  assert.equal(harness.buildingButton.disabled, false)
  assert.equal(harness.buildingButton.textContent, 'Start building')
  assert.equal(harness.buildingButton.title, 'Open Cezar (npx cezar-run)')
  assert.equal(harness.buildingStatus.hidden, true)
})

test('dev splash disables Start building and shows the manual command when unavailable', () => {
  const harness = createBuildingHarness()
  harness.renderBuildingFlow({
    ready: true,
    codingFlow: {
      enabled: true,
      building: { available: false, reason: 'npx_missing', manualCommand: 'npx cezar-run', lastResult: null },
    },
  })

  assert.equal(harness.buildingButton.disabled, true)
  assert.equal(harness.buildingStatus.hidden, false)
  assert.equal(harness.buildingStatus.dataset.kind, 'error')
  assert.equal(harness.buildingStatus.textContent, 'npx missing, run npx cezar-run')
})

test('dev splash disables Start building while any splash action is busy and hides it when disabled', () => {
  const harness = createBuildingHarness()
  const building = { available: true, reason: null, manualCommand: 'npx cezar-run', lastResult: { kind: 'success', code: 'started', message: 'x' } }

  harness.renderBuildingFlow({ codingFlow: { enabled: true, busy: true, building } })
  assert.equal(harness.buildingButton.disabled, true)
  assert.equal(harness.buildingStatus.textContent, 'Started npx cezar-run')

  harness.renderBuildingFlow({ codingFlow: { enabled: false } })
  assert.equal(harness.buildingShell.hidden, true)
})

test('dev splash localizes every Start building label in all supported locales', () => {
  const source = read('scripts/dev-splash.html')
  const requiredKeys = [
    'buildingButtonLabel',
    'buildingTitle',
    'buildingResult_starting',
    'buildingResult_started',
    'buildingResult_already_started',
    'buildingResult_busy',
    'buildingResult_failed',
    'buildingResult_npx_missing',
    'buildingResult_terminal_missing',
  ]

  for (const key of requiredKeys) {
    const occurrences = source.split(`${key}:`).length - 1
    assert.equal(occurrences, 4, `${key} must be translated for all four splash locales`)
  }
})

test('dev runtimes resolve the Start building project directory from their own location', () => {
  assert.match(read('scripts/dev.mjs'), /projectDir: path\.resolve\(path\.dirname\(fileURLToPath\(import\.meta\.url\)\), '\.\.'\),/)
  assert.match(read('scripts/dev-ephemeral.ts'), /projectDir: projectRootDirectory,/)
})
