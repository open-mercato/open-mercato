import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { generateShared } from '../setup/tools/shared.js'
import { generateModulesTs, resolvePreset } from './apply-starter-preset.js'
import { VALID_PRESET_IDS } from './starter-presets.js'

type RoutingDecision = 'spec-first' | 'direct' | 'reuse-spec' | 'ask'

type RoutingResponse = {
  decision: RoutingDecision
  reasonCodes: string[]
  coveringSpecPath?: string
}

type RoutingFixture = {
  id: string
  prompt: string
  expectedDecision: RoutingDecision
  expectedReasonCode: string
  coveringSpecPath?: string
  currentTurnBypass?: boolean
}

type RoutingEvidence = {
  response: RoutingResponse
  readPaths: string[]
  writePaths: string[]
}

const CREATE_APP_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const SPEC_ROOT = '.ai/specs'
const SPEC_TEMPLATE = '.ai/specs/SPEC-000-template.md'
const SPEC_GUIDE = '.ai/guides/spec-delivery.md'
const TIERS_PATH = '.ai/skills/tiers.json'
const STANDALONE_ROOT_TARGET_BYTES = 12 * 1024
const CODEX_DEFAULT_PROJECT_DOC_BYTES = 32 * 1024

const ROUTING_FIXTURES: RoutingFixture[] = [
  {
    id: 'new-feature',
    prompt: 'Add inventory reservations with API, schema, UI, and phased rollout.',
    expectedDecision: 'spec-first',
    expectedReasonCode: 'new-capability',
  },
  {
    id: 'bug-fix',
    prompt: 'Fix the reproducible rounding regression without changing the public contract.',
    expectedDecision: 'direct',
    expectedReasonCode: 'bug-fix',
  },
  {
    id: 'isolated-refactor',
    prompt: 'Rename a private helper in one module without changing behavior or contracts.',
    expectedDecision: 'direct',
    expectedReasonCode: 'isolated-refactor',
  },
  {
    id: 'existing-covering-spec',
    prompt: 'Implement inventory reservations covered by the existing specification.',
    expectedDecision: 'reuse-spec',
    expectedReasonCode: 'covering-spec-found',
    coveringSpecPath: '.ai/specs/2026-08-01-inventory-reservations.md',
  },
  {
    id: 'explicit-current-turn-bypass',
    prompt: 'Add inventory reservations and explicitly skip the spec for this request.',
    expectedDecision: 'direct',
    expectedReasonCode: 'explicit-current-turn-bypass',
    currentTurnBypass: true,
  },
  {
    id: 'urgent-small-feature',
    prompt: 'Ship this small inventory-reservations feature urgently today.',
    expectedDecision: 'spec-first',
    expectedReasonCode: 'new-capability',
  },
  {
    id: 'ambiguous-contract-change',
    prompt: 'Make a quick improvement that may add a new order-state contract.',
    expectedDecision: 'ask',
    expectedReasonCode: 'material-classification-ambiguous',
  },
]

function assertRoutingEvidence(fixture: RoutingFixture, evidence: RoutingEvidence): void {
  assert.equal(evidence.response.decision, fixture.expectedDecision, fixture.id)
  assert.ok(
    evidence.response.reasonCodes.includes(fixture.expectedReasonCode),
    `${fixture.id} must report ${fixture.expectedReasonCode}`,
  )
  assert.equal(
    new Set(evidence.response.reasonCodes).size,
    evidence.response.reasonCodes.length,
    `${fixture.id} reason codes must be unique`,
  )
  assert.ok(evidence.readPaths.includes(SPEC_ROOT), `${fixture.id} must search the emitted spec root`)
  assert.deepEqual(evidence.writePaths, [], `${fixture.id} is a read-only routing proof`)

  const bypassReported = evidence.response.reasonCodes.includes('explicit-current-turn-bypass')
  assert.equal(
    bypassReported,
    fixture.currentTurnBypass === true,
    `${fixture.id} may bypass spec-first only from an explicit instruction in the current turn`,
  )

  if (fixture.expectedDecision === 'reuse-spec') {
    assert.equal(evidence.response.coveringSpecPath, fixture.coveringSpecPath)
    assert.ok(
      evidence.readPaths.includes(fixture.coveringSpecPath!),
      `${fixture.id} must read the exact covering specification`,
    )
  } else {
    assert.equal(evidence.response.coveringSpecPath, undefined)
  }
}

function validEvidence(fixture: RoutingFixture): RoutingEvidence {
  return {
    response: {
      decision: fixture.expectedDecision,
      reasonCodes: [fixture.expectedReasonCode],
      ...(fixture.coveringSpecPath ? { coveringSpecPath: fixture.coveringSpecPath } : {}),
    },
    readPaths: [SPEC_ROOT, ...(fixture.coveringSpecPath ? [fixture.coveringSpecPath] : [])],
    writePaths: [],
  }
}

function assertWritableSpecProof(input: {
  coveringSpecPath?: string
  readPaths: string[]
  writePaths: string[]
  orderedTrace: string[]
}): void {
  const implementationIndex = input.orderedTrace.indexOf('implementation-attempt')
  const specWriteIndex = input.orderedTrace.indexOf('spec-write')
  assert.ok(
    input.writePaths.every((relativePath) => relativePath.startsWith(`${SPEC_ROOT}/`)),
    'the writable proof must not grant source, manifest, migration, or generated-registry writes',
  )
  if (input.coveringSpecPath) {
    assert.ok(input.readPaths.includes(input.coveringSpecPath), 'the exact covering spec must be read')
    assert.ok(input.writePaths.length <= 1, 'an existing spec proof must not create a duplicate')
    assert.ok(
      input.writePaths.length === 0 || input.writePaths[0] === input.coveringSpecPath,
      'an existing spec proof may amend only the covering spec',
    )
  } else {
    assert.equal(input.writePaths.length, 1, 'a new feature proof must create exactly one specification')
    assert.match(input.writePaths[0], /^\.ai\/specs\/\d{4}-\d{2}-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/)
  }
  if (input.writePaths.length > 0) {
    assert.ok(specWriteIndex >= 0, 'every recorded spec write needs ordered trace evidence')
    assert.ok(
      implementationIndex === -1 || specWriteIndex < implementationIndex,
      'the specification write must precede every implementation attempt',
    )
  }
}

function normalizeGeneratedRoot(source: string): string {
  return source.replace(
    /<!-- om:module-guides:start -->[\s\S]*?<!-- om:module-guides:end -->/,
    '<!-- om:module-guides:start -->\n<PRESET_MODULE_FACTS>\n<!-- om:module-guides:end -->',
  )
}

function scaffoldPreset(presetId: string): string {
  const targetDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `om-spec-routing-${presetId}-`)))
  fs.mkdirSync(path.join(targetDir, 'src'), { recursive: true })
  const modulesSource = presetId === 'classic'
    ? fs.readFileSync(path.join(CREATE_APP_ROOT, 'template/src/modules.ts'), 'utf8')
    : generateModulesTs(resolvePreset(presetId).modules)
  fs.writeFileSync(path.join(targetDir, 'src/modules.ts'), modulesSource)
  generateShared({ projectName: 'spec-routing-fixture', targetDir })
  return targetDir
}

test('the failure-first routing oracle covers every spec-first decision branch', () => {
  for (const fixture of ROUTING_FIXTURES) assertRoutingEvidence(fixture, validEvidence(fixture))
})

test('the routing oracle rejects implicit bypasses, wrong classification, writes, and duplicate specs', () => {
  const urgent = ROUTING_FIXTURES.find((fixture) => fixture.id === 'urgent-small-feature')!
  assert.throws(() => assertRoutingEvidence(urgent, {
    ...validEvidence(urgent),
    response: { decision: 'direct', reasonCodes: ['explicit-current-turn-bypass'] },
  }))

  const explicitBypass = ROUTING_FIXTURES.find((fixture) => fixture.id === 'explicit-current-turn-bypass')!
  assert.throws(() => assertRoutingEvidence(explicitBypass, {
    ...validEvidence(explicitBypass),
    response: { decision: 'spec-first', reasonCodes: ['new-capability'] },
  }))

  const ambiguous = ROUTING_FIXTURES.find((fixture) => fixture.id === 'ambiguous-contract-change')!
  assert.throws(() => assertRoutingEvidence(ambiguous, {
    ...validEvidence(ambiguous),
    response: { decision: 'direct', reasonCodes: ['isolated-refactor'] },
  }))

  const bugFix = ROUTING_FIXTURES.find((fixture) => fixture.id === 'bug-fix')!
  assert.throws(() => assertRoutingEvidence(bugFix, {
    ...validEvidence(bugFix),
    writePaths: ['src/modules/orders/index.ts'],
  }))

  assert.throws(() => assertWritableSpecProof({
    coveringSpecPath: '.ai/specs/2026-08-01-inventory-reservations.md',
    readPaths: ['.ai/specs/2026-08-01-inventory-reservations.md'],
    writePaths: [
      '.ai/specs/2026-08-01-inventory-reservations.md',
      '.ai/specs/2026-08-02-inventory-reservations-v2.md',
    ],
    orderedTrace: ['spec-write'],
  }))
})

test('writable proofs require spec-before-code ordering and exact existing-spec reuse', () => {
  assertWritableSpecProof({
    readPaths: [SPEC_ROOT],
    writePaths: ['.ai/specs/2026-08-02-inventory-reservations.md'],
    orderedTrace: ['spec-search', 'spec-write', 'implementation-attempt'],
  })
  assertWritableSpecProof({
    coveringSpecPath: '.ai/specs/2026-08-01-inventory-reservations.md',
    readPaths: [SPEC_ROOT, '.ai/specs/2026-08-01-inventory-reservations.md'],
    writePaths: [],
    orderedTrace: ['spec-search', 'covering-spec-read'],
  })
  assert.throws(() => assertWritableSpecProof({
    readPaths: [SPEC_ROOT],
    writePaths: ['src/modules/inventory/index.ts'],
    orderedTrace: ['implementation-attempt', 'spec-write'],
  }))
})

test('every built-in preset emits one path-stable spec route with resolvable installed skill ownership', () => {
  const generatedRoots: string[] = []
  const emittedTierManifests: string[] = []
  const targets: string[] = []
  const deliveryRoute = fs.readFileSync(
    path.join(CREATE_APP_ROOT, 'agentic/shared/ai/skills/om-help/references/delivery-workflows.md'),
    'utf8',
  )
  const moduleRoute = fs.readFileSync(
    path.join(CREATE_APP_ROOT, 'agentic/shared/ai/skills/om-module-scaffold/SKILL.md'),
    'utf8',
  )
  const uiRoute = fs.readFileSync(
    path.join(CREATE_APP_ROOT, 'agentic/shared/ai/skills/om-backend-ui-design/SKILL.md'),
    'utf8',
  )

  assert.match(deliveryRoute, /Before implementation planning, search `\.ai\/specs\/` once/)
  assert.match(deliveryRoute, /Reuse or amend one covering spec instead of creating a duplicate/)
  assert.match(deliveryRoute, /Bug fixes, minor behavioral corrections, small docs\/config changes, dependency maintenance, and isolated refactors/)
  assert.match(deliveryRoute, /current request explicitly says to skip or bypass it/)
  assert.match(deliveryRoute, /Ask one bounded classification question/)
  for (const owner of [moduleRoute, uiRoute]) {
    assert.match(owner, /Apply the root spec-first gate before implementation planning/)
    assert.match(owner, /one covering spec or a current-request explicit skip\/bypass/)
    assert.match(owner, /invoke `om-spec-writing` with `\.ai\/guides\/spec-delivery\.md` before code/)
    assert.match(owner, /fixes, minor corrections, and isolated refactors without new architecture\/public contracts continue directly/)
  }

  try {
    for (const presetId of VALID_PRESET_IDS) {
      const targetDir = scaffoldPreset(presetId)
      targets.push(targetDir)
      for (const relativePath of [SPEC_TEMPLATE, SPEC_GUIDE, TIERS_PATH]) {
        assert.equal(fs.existsSync(path.join(targetDir, relativePath)), true, `${presetId} must emit ${relativePath}`)
      }

      const root = fs.readFileSync(path.join(targetDir, 'AGENTS.md'), 'utf8')
      const tiersSource = fs.readFileSync(path.join(targetDir, TIERS_PATH), 'utf8')
      const installerSource = fs.readFileSync(path.join(targetDir, 'scripts/install-skills.mjs'), 'utf8')
      const tiers = JSON.parse(tiersSource) as {
        default: string[]
        external: {
          tiers: Record<string, { skills: string[] }>
          skills: string[]
          dependencies: Record<string, string[]>
          contentHashes: Record<string, string>
        }
      }
      const selectedExternalSkills = new Set(
        tiers.default.flatMap((tier) => tiers.external.tiers[tier]?.skills ?? []),
      )

      assert.match(root, /MUST invoke `om-spec-writing`/)
      assert.match(root, /`\.ai\/guides\/spec-delivery\.md`/)
      assert.equal(
        root.match(/Before implementation planning, search `\.ai\/specs\/` once\./g)?.length,
        1,
        `${presetId} must emit the spec-first decision owner exactly once`,
      )
      assert.match(root, /reuse\/amend one covering spec/)
      assert.match(root, /Fixes, minor docs\/config\/dependency work, and isolated no-new-contract refactors/)
      assert.match(root, /current-request explicit skip\/bypass/)
      assert.match(root, /urgency, “small feature”, silence, or earlier preference do not/)
      assert.match(root, /classification materially ambiguous, ask one bounded question/)
      assert.equal(selectedExternalSkills.has('om-spec-writing'), true)
      assert.equal(tiers.external.skills.includes('om-spec-writing'), true)
      assert.deepEqual(tiers.external.dependencies['om-spec-writing'], [])
      assert.match(tiers.external.contentHashes['om-spec-writing'], /^sha256:[a-f0-9]{64}$/)
      assert.match(installerSource, /const canonicalDir = join\(rootDir, '\.agents', 'skills'\)/)
      assert.match(installerSource, /const harnessDir = join\(rootDir, \.\.\.AGENT_DIRECTORIES\[agent\]\)/)
      assert.match(installerSource, /installAgentLinks\(rootDir, agent, allInstalled/)
      assert.equal(
        path.relative(
          path.join(targetDir, '.claude', 'skills'),
          path.join(targetDir, '.agents', 'skills', 'om-spec-writing'),
        ).split(path.sep).join('/'),
        '../../.agents/skills/om-spec-writing',
      )
      assert.doesNotMatch(root, /\.(?:agents|claude|codex)\/skills\/om-spec-writing\/SKILL\.md/)

      generatedRoots.push(normalizeGeneratedRoot(root))
      emittedTierManifests.push(tiersSource)
    }

    assert.equal(new Set(generatedRoots).size, 1, 'starter presets must share one spec-first routing owner')
    assert.equal(new Set(emittedTierManifests).size, 1, 'starter presets must emit one tier manifest')
  } finally {
    for (const targetDir of targets) fs.rmSync(targetDir, { recursive: true, force: true })
  }
})

test('every preset keeps the emitted spec route and its progressive context inside instruction budgets', () => {
  const targets: string[] = []
  try {
    for (const presetId of VALID_PRESET_IDS) {
      const targetDir = scaffoldPreset(presetId)
      targets.push(targetDir)
      const rootBytes = fs.statSync(path.join(targetDir, 'AGENTS.md')).size
      const routedBytes = [
        'AGENTS.md',
        SPEC_GUIDE,
        '.ai/specs/README.md',
        SPEC_TEMPLATE,
      ].reduce((total, relativePath) => total + fs.statSync(path.join(targetDir, relativePath)).size, 0)

      assert.ok(rootBytes <= STANDALONE_ROOT_TARGET_BYTES, `${presetId} root uses ${rootBytes} bytes`)
      assert.ok(
        routedBytes <= CODEX_DEFAULT_PROJECT_DOC_BYTES,
        `${presetId} spec route uses ${routedBytes} bytes`,
      )
    }
  } finally {
    for (const targetDir of targets) fs.rmSync(targetDir, { recursive: true, force: true })
  }
})
