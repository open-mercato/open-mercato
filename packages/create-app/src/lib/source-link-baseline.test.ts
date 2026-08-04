import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const packageRoot = fileURLToPath(new URL('../../', import.meta.url))
const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url))
const harnessDir = path.join(packageRoot, 'agentic/shared/ai/harness')
const validatorPath = path.join(packageRoot, 'agentic/shared/scripts/validate-source-links.mjs')

type Fence = {
  ordinal: number
  heading: string | null
  openingLine: string
  info: string
  contentSha256: string
  unclosed: boolean
}

type TopicRecord = {
  topicId: string
  owner: string
  requirement: string
  href?: string
  resolvedPath?: string
  evidence?: string
}

type BlockRecord = {
  id: string
  asset: string
  ordinal: number
  heading: string | null
  openingLine: string
  info: string
  contentSha256: string
  topicIds: string[]
  targetTopicIds?: string[]
  disposition: string
  rationale?: string
}

type Baseline = {
  baselineSha: string
  baselineAssets: Array<{ path: string; sha256: string; expectedFenceCount: number }>
  blocks: BlockRecord[]
}

type Validator = {
  parseFences: (text: string) => Fence[]
  blockId: (asset: string, ordinal: number) => string
  readPinnedBlob: (root: string, sha: string, relativePath: string) => Buffer
  deriveTopicId: (owner: string, resolvedPath: string) => string | null
  validateTopicRegistry: (input: { registry: unknown; packageRoot: string }) => {
    errors: string[]
    topics: Map<string, TopicRecord>
  }
  validateBaseline: (input: {
    baseline: unknown
    registry: unknown
    packageRoot: string
    loadAsset: (relativePath: string) => Buffer
  }) => { ok: boolean; errors: string[]; derived: Record<string, number> | null }
}

const validator = (await import(pathToFileURL(validatorPath).href)) as unknown as Validator

const baseline = JSON.parse(fs.readFileSync(path.join(harnessDir, 'source-link-baseline.json'), 'utf8')) as Baseline
const registry = JSON.parse(fs.readFileSync(path.join(harnessDir, 'source-link-topics.json'), 'utf8')) as {
  topics: TopicRecord[]
}

// The exact eight assets and per-asset fence counts the canonical spec pins at
// f7c941570003f3abe920b1765995cbef98dcad0b. Duplicated here on purpose: the ledger must be
// checked against the specification table, not only against itself.
const SPEC_FENCE_COUNTS: Record<string, number> = {
  'packages/create-app/agentic/shared/AGENTS.md.template': 4,
  'packages/create-app/agentic/shared/ai/skills/om-backend-ui-design/SKILL.md': 13,
  'packages/create-app/agentic/shared/ai/skills/om-data-model-design/SKILL.md': 19,
  'packages/create-app/agentic/shared/ai/skills/om-eject-and-customize/SKILL.md': 8,
  'packages/create-app/agentic/shared/ai/skills/om-integration-builder/SKILL.md': 30,
  'packages/create-app/agentic/shared/ai/skills/om-module-scaffold/SKILL.md': 24,
  'packages/create-app/agentic/shared/ai/skills/om-system-extension/SKILL.md': 20,
  'packages/create-app/agentic/shared/ai/skills/om-troubleshooter/SKILL.md': 18,
}
const SPEC_TOTAL_FENCES = 136

const loadPinned = (relativePath: string): Buffer =>
  validator.readPinnedBlob(repoRoot, baseline.baselineSha, relativePath)

function cloneBaseline(): Baseline {
  return JSON.parse(JSON.stringify(baseline)) as Baseline
}

function cloneRegistry(): { topics: TopicRecord[] } {
  return JSON.parse(JSON.stringify(registry)) as { topics: TopicRecord[] }
}

function run(input: { baseline?: unknown; registry?: unknown; loadAsset?: (p: string) => Buffer }) {
  return validator.validateBaseline({
    baseline: input.baseline ?? baseline,
    registry: input.registry ?? registry,
    packageRoot,
    loadAsset: input.loadAsset ?? loadPinned,
  })
}

function assertRejects(result: { ok: boolean; errors: string[] }, expected: RegExp): void {
  assert.equal(result.ok, false, `expected a rejection; validator returned ok with ${result.errors.length} errors`)
  assert.ok(
    result.errors.some((error) => expected.test(error)),
    `no error matched ${expected}; got ${JSON.stringify(result.errors.slice(0, 5))}`,
  )
}

test('the pinned baseline assets still hash and parse exactly as the specification table says', () => {
  let total = 0
  for (const [assetPath, expectedFenceCount] of Object.entries(SPEC_FENCE_COUNTS)) {
    const blob = loadPinned(assetPath)
    const record = baseline.baselineAssets.find((asset) => asset.path === assetPath)
    assert.ok(record, `${assetPath} is missing from baselineAssets`)
    assert.equal(record.sha256, createHash('sha256').update(blob).digest('hex'), `${assetPath} full-file hash drifted`)
    assert.equal(record.expectedFenceCount, expectedFenceCount, `${assetPath} declares the wrong fence count`)
    assert.equal(validator.parseFences(blob.toString('utf8')).length, expectedFenceCount, `${assetPath} parses a different fence count`)
    total += expectedFenceCount
  }
  assert.equal(baseline.baselineAssets.length, Object.keys(SPEC_FENCE_COUNTS).length)
  assert.equal(total, SPEC_TOTAL_FENCES)
  assert.equal(baseline.blocks.length, SPEC_TOTAL_FENCES)
})

test('the CommonMark fence parser follows the rules the baseline depends on', () => {
  const indented = validator.parseFences(['   ```ts', 'code', '   ```'].join('\n'))
  assert.equal(indented.length, 1, 'a fence indented by three spaces is a fence')

  const overIndented = validator.parseFences(['    ```ts', 'code', '    ```'].join('\n'))
  assert.equal(overIndented.length, 0, 'a fence indented by four spaces is an indented code block, not a fence')

  const tilde = validator.parseFences(['~~~json', '{ "a": 1 }', '~~~'].join('\n'))
  assert.equal(tilde.length, 1)
  assert.equal(tilde[0].info, 'json')

  const nested = validator.parseFences(['~~~md', '```ts', 'inner', '```', '~~~'].join('\n'))
  assert.equal(nested.length, 1, 'a backtick fence inside a tilde block is content, not a second block')

  const backtickInfo = validator.parseFences(['``` `not-info`', 'paragraph', '```ts', 'real', '```'].join('\n'))
  assert.equal(backtickInfo.length, 1, 'a backtick info string containing a backtick does not open a fence')
  assert.equal(backtickInfo[0].info, 'ts')
  assert.equal(
    backtickInfo[0].contentSha256,
    createHash('sha256').update('real', 'utf8').digest('hex'),
    'the block that does open must start after the invalid fence line',
  )

  const longerClose = validator.parseFences(['```ts', 'x', '`````'].join('\n'))
  assert.equal(longerClose.length, 1, 'a longer closing fence closes the block')

  const headings = validator.parseFences(['## Section', '```bash', '# 1. not a heading', '```'].join('\n'))
  assert.equal(headings[0].heading, 'Section', 'a comment line inside a fence is never read as a heading')
})

test('the checked ledger and topic registry validate as shipped', () => {
  const result = run({})
  assert.deepEqual(result.errors, [])
  assert.equal(result.ok, true)
  assert.equal(result.derived?.blockCount, SPEC_TOTAL_FENCES)
  assert.equal(result.derived?.parsedFenceTotal, SPEC_TOTAL_FENCES)
  assert.equal(result.derived?.assetCount, 8)
})

test('every disposition carries the fields its own class requires', () => {
  const dispositions = new Set(baseline.blocks.map((block) => block.disposition))
  assert.deepEqual(
    [...dispositions].sort(),
    ['linked', 'not-implementation', 'retained-normative-snippet', 'superseded-with-current-rule-and-source'],
    'the ledger must exercise all four dispositions',
  )
  for (const block of baseline.blocks) {
    if (block.disposition === 'not-implementation') {
      assert.deepEqual(block.topicIds, [], `${block.id} must carry no topic`)
      assert.ok(block.rationale, `${block.id} must carry a rationale`)
      continue
    }
    assert.ok(block.topicIds.length > 0, `${block.id} must carry a topic`)
    if (block.disposition === 'linked' || block.disposition === 'superseded-with-current-rule-and-source') {
      assert.ok((block.targetTopicIds ?? []).length > 0, `${block.id} must carry target topics`)
    }
    if (block.disposition !== 'linked') assert.ok(block.rationale, `${block.id} must carry a rationale`)
  }
})

test('a substituted baseline asset is rejected', () => {
  const result = run({
    loadAsset: (relativePath) =>
      relativePath.endsWith('om-troubleshooter/SKILL.md')
        ? Buffer.from('# substituted\n')
        : loadPinned(relativePath),
  })
  assertRejects(result, /hashes .* not the pinned/)
})

test('a missing fence record is rejected', () => {
  const mutated = cloneBaseline()
  const dropped = mutated.blocks.findIndex((block) => block.ordinal === 3)
  mutated.blocks.splice(dropped, 1)
  assertRejects(run({ baseline: mutated }), /fence 3 has no block record/)
})

test('a duplicated fence record is rejected', () => {
  const mutated = cloneBaseline()
  mutated.blocks.push(JSON.parse(JSON.stringify(mutated.blocks[0])) as BlockRecord)
  assertRejects(run({ baseline: mutated }), /duplicate block id/)
})

test('a drifted fence content hash is rejected', () => {
  const mutated = cloneBaseline()
  mutated.blocks[10].contentSha256 = 'f'.repeat(64)
  assertRejects(run({ baseline: mutated }), /records content hash/)
})

test('a drifted opening line, info string, or heading is rejected', () => {
  const byOpeningLine = cloneBaseline()
  byOpeningLine.blocks[1].openingLine = '```nonsense'
  assertRejects(run({ baseline: byOpeningLine }), /records opening line/)

  const byInfo = cloneBaseline()
  byInfo.blocks[1].info = 'nonsense'
  assertRejects(run({ baseline: byInfo }), /records info string/)

  const byHeading = cloneBaseline()
  byHeading.blocks[1].heading = 'Nonsense'
  assertRejects(run({ baseline: byHeading }), /records heading/)
})

test('an unresolved target topic is rejected', () => {
  const mutated = cloneBaseline()
  const linked = mutated.blocks.find((block) => block.disposition === 'linked')
  assert.ok(linked)
  linked.targetTopicIds = ['om-module-scaffold/module-surfaces:never-existed.ts']
  assertRejects(run({ baseline: mutated }), /unresolved target topic/)
})

test('a target topic that is not source-required is rejected', () => {
  const mutated = cloneBaseline()
  const linked = mutated.blocks.find((block) => block.disposition === 'linked')
  assert.ok(linked)
  linked.targetTopicIds = ['rule:root#generation-after-discovery-change']
  assertRejects(run({ baseline: mutated }), /requirement is not source-required/)
})

test('a conditionally missing field is rejected', () => {
  const withoutTargets = cloneBaseline()
  const linked = withoutTargets.blocks.find((block) => block.disposition === 'linked')
  assert.ok(linked)
  delete linked.targetTopicIds
  assertRejects(run({ baseline: withoutTargets }), /must carry a non-empty targetTopicIds/)

  const withoutRationale = cloneBaseline()
  const retained = withoutRationale.blocks.find((block) => block.disposition === 'retained-normative-snippet')
  assert.ok(retained)
  delete retained.rationale
  assertRejects(run({ baseline: withoutRationale }), /must carry a non-empty rationale/)

  const withTopics = cloneBaseline()
  const notImplementation = withTopics.blocks.find((block) => block.disposition === 'not-implementation')
  assert.ok(notImplementation)
  notImplementation.topicIds = ['om-module-scaffold:README.md']
  assertRejects(run({ baseline: withTopics }), /must carry an empty topicIds array/)
})

test('the topic registry only accepts links the owner really renders', () => {
  const mutated = cloneRegistry()
  const sourceTopic = mutated.topics.find((topic) => topic.requirement === 'source-required')
  assert.ok(sourceTopic)
  sourceTopic.href = '../../../src/modules/example/never-rendered.ts'
  assertRejects(run({ registry: mutated }), /which owner .* does not render/)
})

test('the topic registry only accepts a retained rule its owner still states', () => {
  const mutated = cloneRegistry()
  const ruleTopic = mutated.topics.find((topic) => topic.requirement === 'retained-normative-snippet')
  assert.ok(ruleTopic)
  ruleTopic.evidence = 'this sentence is not in any emitted owner'
  assertRejects(run({ registry: mutated }), /declares evidence its owner .* no longer contains/)
})

test('a rendered source link with no registry topic is rejected', () => {
  const mutated = cloneRegistry()
  const index = mutated.topics.findIndex((topic) => topic.requirement === 'source-required')
  mutated.topics.splice(index, 1)
  assertRejects(run({ registry: mutated }), /renders an undeclared source link/)
})

test('a hand-edited topic ID is rejected because IDs are derived, not authored', () => {
  const mutated = cloneRegistry()
  const sourceTopic = mutated.topics.find((topic) => topic.requirement === 'source-required')
  assert.ok(sourceTopic)
  sourceTopic.topicId = 'made-up-topic-id'
  assertRejects(run({ registry: mutated }), /does not match its derived ID/)
})

test('every registry topic the ledger cites resolves, and every source-required target exists in a generated app', () => {
  const known = new Map(registry.topics.map((topic) => [topic.topicId, topic]))
  const cited = new Set<string>()
  for (const block of baseline.blocks) {
    for (const topicId of [...block.topicIds, ...(block.targetTopicIds ?? [])]) {
      assert.ok(known.has(topicId), `${block.id} cites unknown topic ${topicId}`)
      cited.add(topicId)
    }
  }
  assert.ok(cited.size >= 60, `the ledger must exercise the registry broadly; it cites ${cited.size} topics`)

  for (const topic of registry.topics) {
    if (topic.requirement !== 'source-required') continue
    assert.ok(topic.resolvedPath, `${topic.topicId} must record a resolved path`)
    assert.equal(
      validator.deriveTopicId(topic.owner, topic.resolvedPath as string),
      topic.topicId,
      `${topic.topicId} is not derivable from its owner and target`,
    )
  }
})
