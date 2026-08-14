import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { generateCodex } from '../setup/tools/codex.js'
import {
  STANDALONE_ROOT_TARGET_BYTES,
  enforceRootInstructionBudget,
  generateShared,
  injectModuleGuides,
  readEnabledModuleIds,
} from '../setup/tools/shared.js'

const CREATE_APP_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const CODEX_DEFAULT_PROJECT_DOC_BYTES = 32 * 1024
// `example` is no longer listed here: the classic scaffold ships its source but keeps
// it unregistered in src/modules.ts, so it never reaches the enabled-module fact index.
const CLASSIC_APP_ONLY_MODULES = new Set(['ratelimit_probe'])

const ROOT_SOURCES = [
  'template/AGENTS.md',
  'agentic/shared/AGENTS.md.template',
] as const

// Keep this aligned with evaluate-agent-harness.mjs: references, generated
// module fact-sheets, upstream snapshots, and routed external SDLC skills are
// progressive context, not part of the initial payload.
function isInitialContext(relativePath: string): boolean {
  return !relativePath.includes('/references/')
    && !relativePath.startsWith('.ai/guides/modules/')
    && !relativePath.startsWith('.ai/guides/reference-modules/')
    && !relativePath.startsWith('.ai/guides/upstream/')
    && !relativePath.startsWith('.agents/skills/')
}

function assertChainFits(
  root: string,
  name: string,
  relativePaths: string[],
  supplementaryParts: Array<{ label: string; bytes: number }> = [],
): void {
  const initialPaths = relativePaths.filter(isInitialContext)
  const parts = initialPaths.map((relativePath) => {
    const absolutePath = path.join(root, relativePath)
    assert.equal(
      fs.existsSync(absolutePath),
      true,
      `Instruction chain "${name}" is missing ${relativePath}`,
    )
    return { relativePath, bytes: fs.statSync(absolutePath).size }
  })
  const bytes =
    parts.reduce((total, part) => total + part.bytes, 0) +
    supplementaryParts.reduce((total, part) => total + part.bytes, 0)
  const breakdown = [
    ...parts.map((part) => `${part.relativePath} (${part.bytes} B)`),
    ...supplementaryParts.map((part) => `${part.label} (${part.bytes} B)`),
  ].join(' -> ')

  assert.ok(
    bytes <= CODEX_DEFAULT_PROJECT_DOC_BYTES,
    `Instruction chain "${name}" uses ${bytes} bytes, exceeding Codex's ` +
      `${CODEX_DEFAULT_PROJECT_DOC_BYTES}-byte default: ${breakdown}`,
  )
}

// CANON-C raised twelve initial-context budgets so the migrated owners can render visible
// exact-file links instead of backticked paths. Every entry is `[caseId, measuredDeclaredBytes]`
// at the time of the raise: the case must keep enough headroom to hold what it already declares,
// and the raise must stay proportionate — a budget more than 8 KiB above its own measured
// footprint is drift, not a link migration, and fails here.
const CANON_C_RAISED_BUDGETS: ReadonlyArray<readonly [string, number]> = [
  ['OMH-018', 41_361],
  ['OMH-074', 66_008],
  ['OMH-077', 73_448],
  ['OMH-078', 66_008],
  ['OMH-082', 66_729],
  ['OMH-093', 62_605],
  ['OMH-111', 66_008],
  ['OMH-120', 62_605],
  ['OMH-153', 66_729],
  ['OMH-155', 66_729],
  ['OMH-169', 65_957],
  ['OMH-176', 49_871],
]
const CANON_C_MAX_HEADROOM_BYTES = 8 * 1024

test('the link-migration budget raises stay proportionate to what each case declares', () => {
  const cases = JSON.parse(
    fs.readFileSync(
      path.join(CREATE_APP_ROOT, 'agentic/shared/ai/harness/cases.json'),
      'utf8',
    ),
  ) as Array<{ id: string; maxInitialContextBytes: number; maxTotalContextBytes: number }>
  const byId = new Map(cases.map((entry) => [entry.id, entry]))

  for (const [id, measuredBytes] of CANON_C_RAISED_BUDGETS) {
    const record = byId.get(id)
    assert.ok(record, `${id} must remain in the harness catalog`)
    assert.ok(
      record.maxInitialContextBytes >= measuredBytes,
      `${id} must keep a budget that fits the ${measuredBytes} bytes it already declares`,
    )
    assert.ok(
      record.maxInitialContextBytes - measuredBytes <= CANON_C_MAX_HEADROOM_BYTES,
      `${id} carries ${record.maxInitialContextBytes - measuredBytes} bytes of unused initial-context budget; ` +
        'investigate the growth instead of widening the cap further',
    )
    assert.ok(
      record.maxTotalContextBytes >= record.maxInitialContextBytes,
      `${id} total context budget must not fall below its initial budget`,
    )
  }
})

test('standalone root instruction sources stay well below the Codex byte budget', () => {
  for (const relativePath of ROOT_SOURCES) {
    const source = fs.readFileSync(path.join(CREATE_APP_ROOT, relativePath), 'utf8')
    const bytes = fs.statSync(path.join(CREATE_APP_ROOT, relativePath)).size
    assert.ok(
      bytes <= STANDALONE_ROOT_TARGET_BYTES,
      `${relativePath} uses ${bytes} bytes; keep the standalone router at or below ` +
        `${STANDALONE_ROOT_TARGET_BYTES} bytes so routed context fits within Codex's ` +
      `${CODEX_DEFAULT_PROJECT_DOC_BYTES}-byte default`,
    )
    assert.match(source, /yarn mercato agentic:init --update-harness/)
    assert.doesNotMatch(source, /missing context[^\n]+agentic:init`/i)
  }
})

test('existing-module UI routing stays inside the backend UI context slice', () => {
  const rootInstructions = fs.readFileSync(path.join(CREATE_APP_ROOT, 'template/AGENTS.md'), 'utf8')
  const uiSkill = fs.readFileSync(
    path.join(CREATE_APP_ROOT, 'agentic/shared/ai/skills/om-backend-ui-design/SKILL.md'),
    'utf8',
  )

  // The root states the general rule — authored surfaces and browser UI state add
  // `backend-ui`, while hiding/gating/toggling/rewiring does not — because the either/or framing
  // made an installed-host UI change read as UMES-only. The UI skill keeps the narrower
  // page/form/table-only wording, since by then the route is already chosen.
  assert.match(rootInstructions, /replacing\/wrapping, prop-transforming, menu-editing, or adding visible feedback adds `backend-ui`/)
  assert.match(rootInstructions, /browser UI state\/session bootstrap/)
  assert.match(rootInstructions, /merely hiding\/toggling\/rewiring installed UI does not/)
  assert.match(uiSkill, /page\/form\/table-only/)
  for (const instructions of [rootInstructions, uiSkill]) {
    assert.match(instructions, /do not load .*contracts.*module-scaffold/i)
  }
})

test('compatibility routing covers existing public contracts without pulling in additive UI work', () => {
  for (const relativePath of ROOT_SOURCES) {
    const source = fs.readFileSync(path.join(CREATE_APP_ROOT, relativePath), 'utf8')
    // The trigger names the guide's real path: a bare filename does not tell the agent
    // where to read it. It deliberately ties compatibility review to named contract
    // surfaces so the tenant/organization boilerplate carried by many prompts cannot fire it.
    assert.match(source, /Contract-surface changes \(route\/schema\/ID\/export\/seam\/signature\/event payload\/CLI\) MUST read `\.ai\/guides\/upstream\/BACKWARD_COMPATIBILITY\.md`/)
    // The trigger must exclude the tenant-scope boilerplate every prompt carries, or it
    // fires on nearly all 184 cases and burns the refused-read budget.
    assert.match(source, /tenant\/org scope alone is not a contract/)
    assert.match(source, /Additive page\/form\/table\/conflict UI skips it/)
  }
})

test('live evaluation declares every progressive context read in its structured result', () => {
  const source = fs.readFileSync(
    path.join(CREATE_APP_ROOT, 'agentic/shared/scripts/evaluate-agent-harness.mjs'),
    'utf8',
  )
  assert.match(source, /selectedContext lists every exact app-relative instruction or fact path you opened/)
  assert.match(source, /never omit a progressive read from the final object/)
  assert.match(source, /privately audit the task against every Axis 1 route row, every Axis 2 work-unit row, and the Module-Specific Facts mapping/)
  assert.match(source, /selecting its route or guide alone is incomplete/)
  assert.match(source, /while adding nothing from an unmatched row/)
  assert.match(source, /opened task-matching SKILL\.md counts as invoked/)
  assert.match(source, /Evaluate the supplied decision vocabulary one label at a time/)
})

test('generated classic Codex root and representative initial chains fit their byte budgets', () => {
  const targetDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-instruction-budget-')))
  fs.mkdirSync(path.join(targetDir, 'src'), { recursive: true })
  fs.copyFileSync(
    path.join(CREATE_APP_ROOT, 'template/src/modules.ts'),
    path.join(targetDir, 'src', 'modules.ts'),
  )

  try {
    const config = {
      projectName: `instruction-budget-fixture-${'x'.repeat(96)}`,
      targetDir,
    }
    generateShared(config)

    // Source-tree tests do not run build.mjs, which materializes package module
    // fact-sheets under dist/. Reproduce its classic enabled-package intersection
    // before applying the real Codex root patch.
    const classicFactModules = readEnabledModuleIds(path.join(targetDir, 'src', 'modules.ts'))
      .filter((moduleId) => !CLASSIC_APP_ONLY_MODULES.has(moduleId))
      .sort()
    // `example` and `design_system` ship as source but stay unregistered in src/modules.ts,
    // so neither may reach the enabled-module fact index. The index size itself is budget-
    // enforced below rather than pinned to a module count.
    assert.ok(!classicFactModules.includes('example'))
    assert.ok(!classicFactModules.includes('design_system'))
    injectModuleGuides(path.join(targetDir, 'AGENTS.md'), classicFactModules)
    generateCodex(config)
    const shedIndex = enforceRootInstructionBudget(path.join(targetDir, 'AGENTS.md'), classicFactModules)

    const rootInstructions = fs.readFileSync(path.join(targetDir, 'AGENTS.md'), 'utf8')
    assert.match(rootInstructions, /<!-- CODEX_ENFORCEMENT_RULES_START -->/)
    const moduleIndex = rootInstructions.match(/Enabled module facts: ([^\n]+)\./)
    assert.ok(moduleIndex, 'generated classic root must contain the compact module-fact index')
    // The budget is enforced by generation, not by a hard-coded module count, so enabling
    // another template module no longer trips this test. What it still guards is the point
    // where the classic scaffold gets so large that it loses its inline index — a real
    // routing regression worth reviewing rather than an arbitrary ceiling.
    assert.equal(
      shedIndex,
      false,
      `classic scaffold no longer fits its inline module-fact index (${classicFactModules.length} modules); ` +
        'either reclaim root bytes or accept the pointer-form fallback deliberately',
    )
    assert.deepEqual(
      [...moduleIndex[1].matchAll(/`([^`]+)`/g)].map((match) => match[1]),
      classicFactModules,
    )
    assert.ok(
      Buffer.byteLength(rootInstructions) <= STANDALONE_ROOT_TARGET_BYTES,
      `generated classic Codex AGENTS.md uses ${Buffer.byteLength(rootInstructions)} bytes; keep the final root at or below ${STANDALONE_ROOT_TARGET_BYTES} bytes`,
    )
    const chains = [
      {
        name: 'root only',
        paths: ['AGENTS.md'],
        routedMarkers: [] as string[],
      },
      {
        name: 'new module with CRUD data model',
        paths: [
          'AGENTS.md',
          '.ai/guides/contracts.md',
          '.ai/skills/om-module-scaffold/SKILL.md',
          '.ai/skills/om-data-model-design/SKILL.md',
        ],
        routedMarkers: [
          '.ai/guides/contracts.md',
          'om-module-scaffold',
          'om-data-model-design',
        ],
      },
      {
        name: 'backend UI',
        paths: [
          'AGENTS.md',
          '.ai/guides/backend-ui.md',
          '.ai/skills/om-backend-ui-design/SKILL.md',
        ],
        routedMarkers: ['.ai/guides/backend-ui.md', 'om-backend-ui-design'],
      },
      {
        name: 'integration provider',
        paths: [
          'AGENTS.md',
          '.ai/guides/integrations.md',
          '.ai/skills/om-integration-builder/SKILL.md',
        ],
        routedMarkers: ['.ai/guides/integrations.md', 'om-integration-builder'],
      },
      {
        name: 'AI agent and tools',
        paths: [
          'AGENTS.md',
          '.ai/guides/ai-workflows.md',
          '.ai/skills/om-create-ai-agent/SKILL.md',
        ],
        routedMarkers: ['.ai/guides/ai-workflows.md', 'om-create-ai-agent'],
      },
    ]

    for (const chain of chains) {
      for (const marker of chain.routedMarkers) {
        assert.match(
          rootInstructions,
          new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
          `Instruction chain "${chain.name}" is no longer routed by generated AGENTS.md: ${marker}`,
        )
      }
      assertChainFits(targetDir, chain.name, chain.paths)
    }
  } finally {
    fs.rmSync(targetDir, { recursive: true, force: true })
  }
})

// Builds the same classic Codex root the test above builds, but for an arbitrary
// module set, so a growing template can be measured without editing the template.
function generateClassicRoot(extraModules: string[]): { bytes: number; root: string; shedIndex: boolean } {
  const targetDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-instruction-scale-')))
  fs.mkdirSync(path.join(targetDir, 'src'), { recursive: true })
  fs.copyFileSync(
    path.join(CREATE_APP_ROOT, 'template/src/modules.ts'),
    path.join(targetDir, 'src', 'modules.ts'),
  )
  try {
    const config = {
      projectName: `instruction-budget-fixture-${'x'.repeat(96)}`,
      targetDir,
    }
    generateShared(config)
    const factModules = readEnabledModuleIds(path.join(targetDir, 'src', 'modules.ts'))
      .filter((moduleId) => !CLASSIC_APP_ONLY_MODULES.has(moduleId))
      .concat(extraModules)
      .sort()
    injectModuleGuides(path.join(targetDir, 'AGENTS.md'), factModules)
    generateCodex(config)
    const shedIndex = enforceRootInstructionBudget(path.join(targetDir, 'AGENTS.md'), factModules)
    const root = fs.readFileSync(path.join(targetDir, 'AGENTS.md'), 'utf8')
    return { bytes: Buffer.byteLength(root), root, shedIndex }
  } finally {
    fs.rmSync(targetDir, { recursive: true, force: true })
  }
}

test('one more template module still fits the root budget with its inline index intact', () => {
  const { bytes, root, shedIndex } = generateClassicRoot(['channel_discord'])

  assert.equal(shedIndex, false, `adding one module shed the inline index at ${bytes} bytes`)
  assert.ok(
    bytes <= STANDALONE_ROOT_TARGET_BYTES,
    `generated root with one extra module uses ${bytes} bytes, over the ${STANDALONE_ROOT_TARGET_BYTES}-byte target`,
  )
  assert.match(root, /Enabled module facts: [^\n]*`channel_discord`/)
})

test('the module-fact index sheds itself rather than pushing the root past its budget', () => {
  const manyModules = Array.from({ length: 64 }, (_, index) => `scale_probe_${String(index).padStart(2, '0')}`)
  const { bytes, root, shedIndex } = generateClassicRoot(manyModules)

  assert.equal(shedIndex, true, 'a 64-module overflow must trigger the pointer-form fallback')
  assert.ok(
    bytes <= STANDALONE_ROOT_TARGET_BYTES,
    `generated root uses ${bytes} bytes after shedding the index, over the ${STANDALONE_ROOT_TARGET_BYTES}-byte target`,
  )
  assert.match(root, /Enabled module facts: \d+ sheets bundled, too many to index inline/)
  assert.ok(!root.includes('scale_probe_00'), 'the pointer form must not enumerate module ids')
  assert.match(root, /Load `\.ai\/guides\/modules\/<id>\/index\.md` only for a targeted installed module\/host/)
})
