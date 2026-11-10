import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { renderFrameworkExtensionPointsMarkdown } from '../../../cli/src/lib/generators/module-extension-facts.js'
import { enforceRootInstructionBudget, generateShared, injectModuleGuides, readEnabledModuleIds } from '../setup/tools/shared.js'
import { generateCodex } from '../setup/tools/codex.js'

type HarnessCase = {
  id: string
  context: {
    required: string[]
    allowedExtra?: string[]
    forbidden: string[]
    exampleRoots?: Array<{ maxFiles: number; maxBytes: number }>
  }
  maxContextFiles: number
  maxInitialContextBytes: number
  maxTotalContextBytes: number
}
const packageRoot = new URL('../../', import.meta.url)
const read = (file: string): string => fs.readFileSync(new URL(file, packageRoot), 'utf8')
const cases = JSON.parse(read('agentic/shared/ai/harness/cases.json')) as HarnessCase[]

test('Markdown customization measures its complete context within tightly bounded per-case limits', async (context) => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'om-compat-context-'))
  try {
    const config = { targetDir: fixture, projectName: 'compatibility-context-budget' }
    fs.mkdirSync(path.join(fixture, 'src'), { recursive: true })
    fs.copyFileSync(new URL('../../template/src/modules.ts', import.meta.url), path.join(fixture, 'src/modules.ts'))
    const factModules = readEnabledModuleIds(path.join(fixture, 'src/modules.ts'))
      .filter((moduleId) => moduleId !== 'ratelimit_probe')
      .sort()
    generateShared(config)
    injectModuleGuides(path.join(fixture, 'AGENTS.md'), factModules)
    generateCodex(config)
    enforceRootInstructionBudget(path.join(fixture, 'AGENTS.md'), factModules)
    fs.writeFileSync(path.join(fixture, '.ai/guides/framework-extension-points.md'), renderFrameworkExtensionPointsMarkdown())
    fs.mkdirSync(path.join(fixture, '.ai/guides/upstream'), { recursive: true })
    fs.copyFileSync(new URL('../../../../BACKWARD_COMPATIBILITY.md', import.meta.url), path.join(fixture, '.ai/guides/upstream/BACKWARD_COMPATIBILITY.md'))
    stageMarkdownSources(fixture)
    const evaluator = await loadEvaluator()
    const record = cases.find(record => record.id === 'OMH-242')
    assert.ok(record)
    const instructionPaths = [...new Set([...record.context.required, ...(record.context.allowedExtra ?? [])])]
    assert.ok(instructionPaths.every(relative => !/[?*]/.test(relative)))
    const sourcePaths = evaluator.exampleReadAllowlist(record, fixture)
    const paths = [...new Set([...instructionPaths, ...sourcePaths])]
    const bytes = sumBytes(fixture, paths)
    const initialPaths = paths.filter(isInitialContextPath)
    const initialBytes = sumBytes(fixture, initialPaths)
    context.diagnostic(`${paths.length} files / ${bytes} total bytes; ${initialPaths.length} initial files / ${initialBytes} initial bytes`)
    assert.equal(record.maxInitialContextBytes, 73728)
    assert.equal(record.maxTotalContextBytes, 348160)
    assert.ok(bytes <= record.maxTotalContextBytes)
    assert.ok(record.maxTotalContextBytes - bytes <= 4096)
    assert.ok(initialPaths.length <= record.maxContextFiles)
    assert.ok(initialBytes <= record.maxInitialContextBytes)
    assert.ok(record.maxInitialContextBytes - initialBytes <= 4096)
    assert.ok(record.context.forbidden.includes('.env*'))
    assert.ok(record.context.forbidden.includes('.git/**'))
    assert.ok(fs.statSync(path.join(fixture, 'AGENTS.md')).size <= 12288)
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true })
  }
})

const markdownSourcePaths = [
  'src/modules/example/README.md',
  'src/modules/example/references/surface-map.md',
  'src/modules/example/references/surface-inventory.json',
  'src/modules/example/widgets/components.ts',
  'src/modules/example/components/ComponentOverrideShowcase.tsx',
  'src/modules/example/backend/component-overrides/page.tsx',
  'src/modules/example/backend/component-overrides/page.meta.ts',
  'node_modules/@open-mercato/ui/src/backend/inputs/MarkdownField.tsx',
  'node_modules/@open-mercato/ui/src/backend/markdown/codeBlockLanguages.ts',
]

function isInitialContextPath(relative: string): boolean {
  return !relative.includes('/references/')
    && !relative.startsWith('.ai/framework-context/')
    && !relative.startsWith('.ai/guides/modules/')
    && !relative.startsWith('.ai/guides/reference-modules/')
    && !relative.startsWith('.ai/guides/upstream/')
    && !relative.startsWith('.agents/skills/')
}

function stageMarkdownSources(fixture: string): void {
  for (const relative of [...markdownSourcePaths, 'node_modules/@open-mercato/ui/package.json']) {
    const source = relative.startsWith('node_modules/')
      ? new URL(`../../../../packages/ui/${relative.slice('node_modules/@open-mercato/ui/'.length)}`, import.meta.url)
      : new URL(`../../template/${relative}`, import.meta.url)
    const destination = path.join(fixture, relative)
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    fs.copyFileSync(source, destination)
  }
}

test('Markdown customization budgets cover exact example and installed contracts including the inventory', async () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'om-markdown-context-'))
  try {
    generateShared({ targetDir: fixture, projectName: 'markdown-context-budget' })
    stageMarkdownSources(fixture)
    const record = cases.find(record => record.id === 'OMH-242')
    assert.ok(record)
    const evaluator = await loadEvaluator()
    const paths = evaluator.exampleReadAllowlist(record, fixture)
    assert.deepEqual(paths.toSorted(), markdownSourcePaths.toSorted())
    const declaration = record.context.exampleRoots?.[0]
    assert.ok(declaration)
    assert.equal(declaration.maxFiles, 9)
    assert.equal(declaration.maxBytes, 204800)
    assert.equal(paths.length, declaration.maxFiles)
    const bytes = sumBytes(fixture, paths)
    assert.ok(bytes <= declaration.maxBytes)
    assert.ok(declaration.maxBytes - bytes <= 4096)
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true })
  }
})

function sumBytes(fixture: string, paths: string[]): number {
  return paths.reduce((total, relative) => total + fs.statSync(path.join(fixture, relative)).size, 0)
}

async function loadEvaluator(): Promise<{ exampleReadAllowlist: (record: HarnessCase, root: string) => string[] }> {
  return import(new URL('../../agentic/shared/scripts/evaluate-agent-harness.mjs', import.meta.url).href)
}
