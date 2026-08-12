import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { extractModuleFacts, isExactSourceFilePath, renderModuleFactsMarkdown } from '../module-facts'

const MARKDOWN_LINK_TARGET = /\]\(\.\.\/\.\.\/\.\.\/([^)#]+)(?:#L\d+)?\)/g

function collectLinkTargets(markdown: string): string[] {
  return [...markdown.matchAll(MARKDOWN_LINK_TARGET)].map((match) => match[1])
}

function writeFixture(root: string, relativePath: string, source: string): void {
  const filePath = path.join(root, relativePath)
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, source)
}

describe('module-facts source-linked extension surfaces', () => {
  let temporaryRoot: string
  let moduleRoot: string

  beforeAll(() => {
    temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'module-facts-source-links-'))
    moduleRoot = path.join(temporaryRoot, 'facts')
    writeFixture(moduleRoot, 'index.ts', "export const metadata = { title: 'Facts' }\n")
    writeFixture(
      moduleRoot,
      'api/records/route.ts',
      "export const metadata = { path: '/facts/records-custom' }\nexport async function GET() {}\n",
    )
    writeFixture(moduleRoot, 'backend/page.tsx', 'export default function FactsPage() { return null }\n')
    writeFixture(
      moduleRoot,
      'backend/facts/items/[id]/page.tsx',
      'export default function FactItemPage() { return null }\n',
    )
    writeFixture(
      moduleRoot,
      'frontend/facts/portal/[id]/page.tsx',
      'export default function FactPortalPage() { return null }\n',
    )
    writeFixture(
      moduleRoot,
      'cli.ts',
      "const commands = [{ command: 'facts:sync' }, { command: 'facts:check' }]\nexport default commands\n",
    )
    writeFixture(
      moduleRoot,
      'ai-tools/tools-pack.ts',
      "type FactsAiToolDefinition = { name: string; description: string }\nconst inspectTool: FactsAiToolDefinition = { name: 'facts.inspect', description: 'Inspect facts' }\nexport default [inspectTool]\n",
    )
    writeFixture(
      moduleRoot,
      'ai-tools.ts',
      "type FactsAiToolDefinition = { name: string; description: string }\nconst listTool: FactsAiToolDefinition = { name: 'facts.list', description: 'List facts' }\nexport const aiTools = [listTool]\nexport default aiTools\n",
    )
    writeFixture(
      moduleRoot,
      'ai-agents.ts',
      "type AiAgentDefinition = { id: string; label: string }\nconst AGENT_ID = 'facts.assistant'\nconst agent: AiAgentDefinition = { id: AGENT_ID, label: 'Facts assistant' }\nexport const aiAgents = [agent]\nexport default aiAgents\n",
    )
  })

  afterAll(() => {
    fs.rmSync(temporaryRoot, { recursive: true, force: true })
  })

  it('emits portable source links for routes, pages, commands, tools, and agents', () => {
    const registrySource = `export const modules = [{
      id: 'facts',
      apis: [{
        path: '/facts/records-custom',
        handlers: { GET: async () => undefined },
        metadata: { GET: { requireFeatures: ['facts.view'] } },
      }],
    }]`
    const facts = extractModuleFacts({
      moduleId: 'facts',
      moduleRoot,
      sourcePackage: '@open-mercato/example',
      sourceVersion: '1.2.3',
      registrySource,
    })

    expect(facts.sourceRoot).toBe('node_modules/@open-mercato/example/src/modules/facts')
    expect(facts.apiRoutes).toEqual([
      {
        path: '/facts/records-custom',
        methods: ['GET'],
        auth: { GET: { requireFeatures: ['facts.view'] } },
        sourcePath: 'node_modules/@open-mercato/example/src/modules/facts/api/records/route.ts',
      },
    ])
    expect(facts.backendPages).toEqual([
      {
        path: '/backend/facts',
        sourcePath: 'node_modules/@open-mercato/example/src/modules/facts/backend/page.tsx',
      },
      {
        path: '/backend/facts/items/[id]',
        sourcePath: 'node_modules/@open-mercato/example/src/modules/facts/backend/facts/items/[id]/page.tsx',
      },
    ])
    expect(facts.frontendPages).toEqual([
      {
        path: '/facts/portal/[id]',
        sourcePath: 'node_modules/@open-mercato/example/src/modules/facts/frontend/facts/portal/[id]/page.tsx',
      },
    ])
    expect(facts.cli).toEqual(['facts:sync', 'facts:check'])
    expect(facts.cliCommands.map((command) => command.command)).toEqual(['facts:sync', 'facts:check'])
    expect(facts.aiTools.map((tool) => tool.name)).toEqual(['facts.inspect', 'facts.list'])
    expect(facts.aiAgents.map((agentFact) => agentFact.id)).toEqual(['facts.assistant'])

    const markdown = renderModuleFactsMarkdown(facts)
    expect(markdown).toContain('## Backend pages')
    expect(markdown).toContain('## Frontend pages')
    expect(markdown).toContain('## CLI commands')
    expect(markdown).toContain('## AI tools / MCP capabilities')
    expect(markdown).toContain('## AI agents')
    expect(markdown).toContain(
      '(../../../node_modules/@open-mercato/example/src/modules/facts/api/records/route.ts)',
    )
  })

  it('links only exact module code files and never a directory', () => {
    const facts = extractModuleFacts({
      moduleId: 'facts',
      moduleRoot,
      sourcePackage: '@open-mercato/example',
      sourceVersion: '1.2.3',
    })
    const markdown = renderModuleFactsMarkdown(facts)
    const targets = collectLinkTargets(markdown)

    expect(targets.length).toBeGreaterThan(0)
    expect(targets.filter((target) => !isExactSourceFilePath(target))).toEqual([])
  })

  it('renders the directory-valued source root as plain text instead of a folder link', () => {
    const facts = extractModuleFacts({
      moduleId: 'facts',
      moduleRoot,
      sourcePackage: '@open-mercato/example',
      sourceVersion: '1.2.3',
    })
    const markdown = renderModuleFactsMarkdown(facts)

    expect(markdown).toContain('Source root: node_modules/@open-mercato/example/src/modules/facts\n')
    expect(markdown).not.toContain('(../../../node_modules/@open-mercato/example/src/modules/facts)')
  })

  it('classifies exact files and directories consistently', () => {
    expect(isExactSourceFilePath('packages/core/src/modules/customers/index.ts')).toBe(true)
    expect(isExactSourceFilePath('packages/ui/src/backend/DataTable.tsx')).toBe(true)
    expect(isExactSourceFilePath('node_modules/@open-mercato/core/dist/modules/customers/acl.js')).toBe(true)
    expect(isExactSourceFilePath('packages/ui/src')).toBe(false)
    expect(isExactSourceFilePath('node_modules/@open-mercato/core/src/modules/customers')).toBe(false)
  })
})
