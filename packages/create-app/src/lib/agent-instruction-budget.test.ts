import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { generateShared } from '../setup/tools/shared.js'

const CREATE_APP_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const CODEX_DEFAULT_PROJECT_DOC_BYTES = 32 * 1024
const STANDALONE_ROOT_TARGET_BYTES = 12 * 1024
const CODEX_ENFORCEMENT_SOURCE = 'agentic/codex/enforcement-rules.md'

const ROOT_SOURCES = [
  'template/AGENTS.md',
  'agentic/shared/AGENTS.md.template',
] as const

// Keep this aligned with evaluate-agent-harness.mjs: references and generated
// module fact-sheets are progressive context, not part of the initial payload.
function isInitialContext(relativePath: string): boolean {
  return !relativePath.includes('/references/') && !relativePath.startsWith('.ai/guides/modules/')
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
    const bytes = fs.statSync(path.join(CREATE_APP_ROOT, relativePath)).size
    assert.ok(
      bytes <= STANDALONE_ROOT_TARGET_BYTES,
      `${relativePath} uses ${bytes} bytes; keep the standalone router at or below ` +
        `${STANDALONE_ROOT_TARGET_BYTES} bytes so routed context fits within Codex's ` +
        `${CODEX_DEFAULT_PROJECT_DOC_BYTES}-byte default`,
    )
  }
})

test('generated representative initial instruction chains fit the Codex default byte budget', () => {
  const targetDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-instruction-budget-')))
  fs.mkdirSync(path.join(targetDir, 'src'), { recursive: true })
  fs.writeFileSync(path.join(targetDir, 'src', 'modules.ts'), 'export const enabledModules = []\n')

  try {
    const config = { projectName: 'instruction-budget-fixture', targetDir }
    generateShared(config)

    // A freshly generated Codex root prepends this block plus two separator
    // newlines. Account for it without depending on a pre-built dist/ tree.
    const codexEnforcementBytes =
      fs.statSync(path.join(CREATE_APP_ROOT, CODEX_ENFORCEMENT_SOURCE)).size + 2

    const rootInstructions = fs.readFileSync(path.join(targetDir, 'AGENTS.md'), 'utf8')
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
          '.ai/guides/architecture.md',
          '.ai/guides/contracts.md',
          '.ai/skills/om-module-scaffold/SKILL.md',
          '.ai/skills/om-data-model-design/SKILL.md',
        ],
        routedMarkers: [
          '.ai/guides/architecture.md',
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
      assertChainFits(targetDir, chain.name, chain.paths, [
        { label: 'Codex enforcement block', bytes: codexEnforcementBytes },
      ])
    }
  } finally {
    fs.rmSync(targetDir, { recursive: true, force: true })
  }
})
