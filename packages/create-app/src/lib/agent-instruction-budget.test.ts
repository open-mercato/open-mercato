import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { generateCodex } from '../setup/tools/codex.js'
import { generateShared, injectModuleGuides, readEnabledModuleIds } from '../setup/tools/shared.js'

const CREATE_APP_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const CODEX_DEFAULT_PROJECT_DOC_BYTES = 32 * 1024
const STANDALONE_ROOT_TARGET_BYTES = 12 * 1024
const CLASSIC_APP_ONLY_MODULES = new Set(['example', 'ratelimit_probe'])

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
    // where to read it. It deliberately ties preservation/stability to a named public
    // surface so the tenant/organization boilerplate carried by many prompts cannot fire it.
    assert.match(source, /Adding\/changing\/removing, preserving, or keeping stable a public route\/schema\/ID\/export\/seam\/signature\/event-payload\/CLI MUST read `\.ai\/guides\/upstream\/BACKWARD_COMPATIBILITY\.md`/)
    // The trigger must exclude the tenant-scope boilerplate every prompt carries, or it
    // fires on nearly all 184 cases and burns the refused-read budget.
    assert.match(source, /tenant\/org scope alone is not a contract surface/)
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
    assert.equal(classicFactModules.length, 50, 'classic scaffold fact index changed; review its root budget')
    injectModuleGuides(path.join(targetDir, 'AGENTS.md'), classicFactModules)
    generateCodex(config)

    const rootInstructions = fs.readFileSync(path.join(targetDir, 'AGENTS.md'), 'utf8')
    assert.match(rootInstructions, /<!-- CODEX_ENFORCEMENT_RULES_START -->/)
    const moduleIndex = rootInstructions.match(/Enabled module facts: ([^\n]+)\./)
    assert.ok(moduleIndex, 'generated classic root must contain the compact module-fact index')
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
