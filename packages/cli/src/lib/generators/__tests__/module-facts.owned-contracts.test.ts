import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { extractModuleFacts, renderModuleFactsMarkdown, toModuleFactsJsonEntry } from '../module-facts'
import type { ModuleFacts, ModuleOwnedContractFact } from '../module-facts'
import { buildFactSourceLookup } from '../module-fact-sources'

function writeFixture(root: string, relativePath: string, source: string): void {
  const filePath = path.join(root, relativePath)
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, source)
}

function ownedById(
  facts: ModuleFacts,
  kind: keyof NonNullable<ModuleFacts['ownedContracts']>,
  id: string,
): ModuleOwnedContractFact | undefined {
  return facts.ownedContracts?.[kind]?.find((fact) => fact.id === id)
}

describe('module-facts owned contracts + provenance (Spec 1)', () => {
  let temporaryRoot: string
  let moduleRoot: string
  let facts: ModuleFacts

  beforeAll(() => {
    temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'module-facts-owned-'))
    moduleRoot = path.join(temporaryRoot, 'facts')

    writeFixture(
      moduleRoot,
      'index.ts',
      "export const metadata = { name: 'facts', title: 'Facts', version: '1.2.3', requires: ['auth', 'catalog'], ejectable: true }\n",
    )
    writeFixture(
      moduleRoot,
      'data/entities.ts',
      "import { Entity, Property } from '@mikro-orm/core'\n"
        + "@Entity({ tableName: 'facts_widget' })\nexport class FactsWidget { updatedAt!: Date }\n",
    )
    writeFixture(
      moduleRoot,
      'events.ts',
      "export const events = [{ id: 'facts.widget.created', category: 'facts' }]\n",
    )
    writeFixture(
      moduleRoot,
      'acl.ts',
      "export const features = [{ id: 'facts.view' }, { id: 'facts.manage' }]\n",
    )
    writeFixture(
      moduleRoot,
      'search.ts',
      "export const searchConfig = { entities: [{ entityId: 'facts:facts_widget' }] }\n",
    )
    writeFixture(
      moduleRoot,
      'notifications.ts',
      "export const notificationTypes = [{ type: 'facts.alert' }]\n",
    )
    writeFixture(
      moduleRoot,
      'ce.ts',
      "const systemEntities = [{ id: 'facts:facts_widget', label: 'Widget', fields: [] }]\nexport default systemEntities\n",
    )
    writeFixture(
      moduleRoot,
      'encryption.ts',
      "export const defaultEncryptionMaps = [{ entityId: 'facts:facts_widget', fields: [{ field: 'secret_snapshot' }, { field: 'notes' }] }]\n",
    )
    writeFixture(
      moduleRoot,
      'setup.ts',
      "export const setup = {\n"
        + "  defaultRoleFeatures: { admin: ['facts.manage'], employee: ['facts.view'] },\n"
        + "  async onTenantCreated() {},\n"
        + "  seedDefaults: async () => {},\n"
        + "}\n",
    )
    writeFixture(
      moduleRoot,
      'backend/middleware.ts',
      "export const middleware = [{ id: 'facts.backend.redirect', mode: 'backend', priority: 10, run() {} }]\n",
    )
    writeFixture(
      moduleRoot,
      'frontend/middleware.ts',
      "export const middleware = [{ id: 'facts.frontend.guard', mode: 'frontend', run() {} }, { mode: 'frontend', run() {} }]\n",
    )
    writeFixture(
      moduleRoot,
      'backend/page.tsx',
      "export const metadata = { requireAuth: true, requireFeatures: ['facts.view'], group: 'crm' }\nexport default function Page() { return null }\n",
    )
    // Commands: recursive discovery, plus a duplicate id declared in two files.
    writeFixture(
      moduleRoot,
      'commands/root.ts',
      "import { registerCommand } from '@open-mercato/shared'\nregisterCommand({ id: 'facts.sync' })\n",
    )
    writeFixture(
      moduleRoot,
      'commands/nested/deep.ts',
      "import { registerCommand } from '@open-mercato/shared'\nregisterCommand({ id: 'facts.reindex' })\nregisterCommand({ id: 'facts.sync' })\n",
    )
    // Workers: recursive discovery + static queue/name/concurrency, plus an unresolvable id.
    writeFixture(
      moduleRoot,
      'workers/sync.ts',
      "export const metadata = { id: 'facts:sync', queue: 'facts-sync', name: 'Sync', concurrency: 2 }\nexport default async function handle() {}\n",
    )
    writeFixture(
      moduleRoot,
      'workers/nested/deep.ts',
      "export const metadata = { id: 'facts:deep' }\nexport default async function handle() {}\n",
    )
    writeFixture(
      moduleRoot,
      'workers/dynamic.ts',
      "const QUEUE = computeQueue()\nexport const metadata = { queue: QUEUE }\nexport default async function handle() {}\n",
    )
    // Subscribers: nested directory must be discovered like runtime.
    writeFixture(
      moduleRoot,
      'subscribers/nested/on-created.ts',
      "export const metadata = { id: 'facts:on-created', event: 'facts.widget.created', persistent: false }\nexport default async function handle() {}\n",
    )
    // DI: cover function/class/value/alias/lifetime/injectionMode/spread/unresolved.
    writeFixture(
      moduleRoot,
      'di.ts',
      "import { asFunction, asClass, asValue, aliasTo } from 'awilix'\n"
        + "import { RealService } from './lib/realService'\n"
        + "const SENSITIVE_CONFIG = { apiKey: 'super-secret-value-9000' }\n"
        + "const baseRegistrations = {}\n"
        + "export function register(container) {\n"
        + "  container.register({\n"
        + "    ...baseRegistrations,\n"
        + "    fnService: asFunction(makeService).singleton(),\n"
        + "    ClassService: asClass(RealService).scoped().proxy(),\n"
        + "    ValueToken: asValue(SENSITIVE_CONFIG),\n"
        + "    aliasToken: aliasTo('ClassService'),\n"
        + "    spreadFn: asFunction(() => 1).transient().classic(),\n"
        + "    dynamicOne: someDynamicFactory(),\n"
        + "  })\n"
        + "}\n",
    )
    // Generator plugins.
    writeFixture(
      moduleRoot,
      'generators.ts',
      "const pluginA = { id: 'facts.registry', conventionFile: 'facts.items.ts', outputFileName: 'facts-items.generated.ts' }\nexport const generatorPlugins = [pluginA]\n",
    )
    // AI agent extensions (file overrides).
    writeFixture(
      moduleRoot,
      'ai-agents.ts',
      "type AiAgentDefinition = { id: string }\nconst agent: AiAgentDefinition = { id: 'facts.assistant' }\nexport const aiAgents = [agent]\nexport const aiAgentExtensions = [defineAiAgentExtension({ targetAgentId: 'catalog.catalog_assistant', appendAllowedTools: ['facts.stats'] })]\nexport const aiToolOverrides = { 'legacy_tool': null }\nexport default aiAgents\n",
    )

    facts = extractModuleFacts({
      moduleId: 'facts',
      moduleRoot,
      sourcePackage: '@open-mercato/example',
      sourceVersion: '1.0.0',
    })
  })

  afterAll(() => {
    fs.rmSync(temporaryRoot, { recursive: true, force: true })
  })

  it('extracts module-metadata owned contract with only safe scalar fields', () => {
    const fact = ownedById(facts, 'module-metadata', 'facts')
    expect(fact).toBeDefined()
    expect(fact?.metadata).toEqual({ name: 'facts', version: '1.2.3', requires: ['auth', 'catalog'], ejectable: true })
    expect(fact?.source.sourcePath).toBe('node_modules/@open-mercato/example/src/modules/facts/index.ts')
  })

  it('discovers recursive domain commands and selects a canonical duplicate source with a diagnostic', () => {
    const ids = (facts.ownedContracts?.command ?? []).map((fact) => fact.id)
    expect(ids).toEqual(['facts.reindex', 'facts.sync'])
    // facts.sync is declared in both commands/root.ts and commands/nested/deep.ts.
    const sync = ownedById(facts, 'command', 'facts.sync')
    expect(sync?.source.sourcePath).toBe('node_modules/@open-mercato/example/src/modules/facts/commands/nested/deep.ts')
    const duplicate = facts.factDiagnostics?.find(
      (diagnostic) => diagnostic.code === 'duplicate-source' && diagnostic.kind === 'command' && diagnostic.id === 'facts.sync',
    )
    expect(duplicate?.source?.sourcePath).toBe('node_modules/@open-mercato/example/src/modules/facts/commands/root.ts')
  })

  it('discovers recursive workers with static metadata and diagnoses dynamic ids', () => {
    const sync = ownedById(facts, 'worker', 'facts:sync')
    expect(sync?.metadata).toEqual({ queue: 'facts-sync', name: 'Sync', concurrency: 2 })
    expect(ownedById(facts, 'worker', 'facts:deep')).toBeDefined()
    const dynamic = facts.factDiagnostics?.find(
      (diagnostic) => diagnostic.code === 'unresolved-static-contract' && diagnostic.kind === 'worker',
    )
    expect(dynamic).toBeDefined()
    // The unresolvable queue identifier must never be serialized.
    expect(JSON.stringify(facts.ownedContracts?.worker)).not.toContain('QUEUE')
  })

  it('extracts page middleware for both surfaces and diagnoses id-less entries', () => {
    expect(ownedById(facts, 'page-middleware', 'facts.backend.redirect')?.metadata).toEqual({
      surface: 'backend',
      mode: 'backend',
      priority: 10,
    })
    expect(ownedById(facts, 'page-middleware', 'facts.frontend.guard')?.metadata).toMatchObject({ surface: 'frontend' })
    expect(
      facts.factDiagnostics?.some((diagnostic) => diagnostic.kind === 'page-middleware' && diagnostic.code === 'unresolved-static-contract'),
    ).toBe(true)
  })

  it('extracts setup hooks and role identifiers only', () => {
    const setup = ownedById(facts, 'setup', 'facts:setup')
    expect(setup?.metadata).toEqual({ hooks: ['onTenantCreated', 'seedDefaults'], roles: ['admin', 'employee'] })
  })

  it('extracts encryption entity ids with declared field names', () => {
    const encryption = ownedById(facts, 'encryption', 'facts:facts_widget')
    expect(encryption?.metadata).toEqual({ fields: ['notes', 'secret_snapshot'] })
  })

  it('extracts custom entity ownership from ce.ts', () => {
    expect((facts.ownedContracts?.['custom-entity'] ?? []).map((fact) => fact.id)).toEqual(['facts:facts_widget'])
  })

  it('extracts AI file-override extensions (agent + tool)', () => {
    const ids = (facts.ownedContracts?.['ai-extension'] ?? []).map((fact) => fact.id).sort()
    expect(ids).toEqual(['catalog.catalog_assistant', 'legacy_tool'])
  })

  it('extracts generator plugin ownership with safe metadata', () => {
    expect(ownedById(facts, 'generator-plugin', 'facts.registry')?.metadata).toEqual({
      conventionFile: 'facts.items.ts',
      outputFileName: 'facts-items.generated.ts',
    })
  })

  it('classifies every supported DI registration form without leaking values', () => {
    const di = facts.ownedContracts?.['di-registration'] ?? []
    const byToken = new Map(di.map((fact) => [fact.id, fact.metadata]))
    expect(byToken.get('fnService')).toEqual({ registrationKind: 'function', providerSymbol: 'makeService', lifetime: 'singleton' })
    expect(byToken.get('ClassService')).toEqual({
      registrationKind: 'class',
      providerSymbol: 'RealService',
      lifetime: 'scoped',
      injectionMode: 'proxy',
    })
    expect(byToken.get('ValueToken')).toEqual({ registrationKind: 'value' })
    expect(byToken.get('aliasToken')).toEqual({ registrationKind: 'alias', providerSymbol: 'ClassService' })
    expect(byToken.get('spreadFn')).toEqual({ registrationKind: 'function', lifetime: 'transient', injectionMode: 'classic' })
    // Dynamic registration is diagnosed, not fabricated.
    expect(byToken.has('dynamicOne')).toBe(false)
    expect(
      facts.factDiagnostics?.some((diagnostic) => diagnostic.kind === 'di-registration' && diagnostic.id === 'dynamicOne'),
    ).toBe(true)
  })

  it('derives the legacy diTokens list from function/class registrations only, preserving order', () => {
    expect(facts.diTokens).toEqual(['fnService', 'ClassService', 'spreadFn'])
  })

  it('never leaks asValue payloads, secrets, config bodies, or absolute paths', () => {
    const serialized = JSON.stringify(toModuleFactsJsonEntry(facts))
    expect(serialized).not.toContain('SENSITIVE_CONFIG')
    expect(serialized).not.toContain('super-secret-value-9000')
    expect(serialized).not.toContain('apiKey')
    expect(serialized).not.toContain('makeService(')
    expect(serialized).not.toContain(temporaryRoot)
    expect(serialized).not.toMatch(/"sourcePath":\s*"\//)
  })

  it('resolves every proven fact through the uniform provenance index', () => {
    const resolve = buildFactSourceLookup(facts)
    expect(resolve('entity', 'facts:facts_widget')?.sourcePath).toBe(
      'node_modules/@open-mercato/example/src/modules/facts/data/entities.ts',
    )
    expect(resolve('event', 'facts.widget.created')?.sourcePath).toBe(
      'node_modules/@open-mercato/example/src/modules/facts/events.ts',
    )
    expect(resolve('acl-feature', 'facts.view')?.sourcePath).toBe(
      'node_modules/@open-mercato/example/src/modules/facts/acl.ts',
    )
    expect(resolve('search', 'facts:facts_widget')?.sourcePath).toBe(
      'node_modules/@open-mercato/example/src/modules/facts/search.ts',
    )
    expect(resolve('notification', 'facts.alert')?.sourcePath).toBe(
      'node_modules/@open-mercato/example/src/modules/facts/notifications.ts',
    )
    expect(resolve('subscriber', 'facts:on-created')?.sourcePath).toBe(
      'node_modules/@open-mercato/example/src/modules/facts/subscribers/nested/on-created.ts',
    )

    // Kinds whose declaration site is already serialized inline are indexed as typed
    // pointers, and still resolve to a real source through the same lookup.
    const commandEntry = facts.factSources?.find(
      (entry) => entry.kind === 'command' && entry.id === 'facts.sync',
    )
    expect(commandEntry?.source).toBeUndefined()
    expect(commandEntry?.factRef).toEqual({ factSection: 'ownedContracts.command' })
    expect(resolve('command', 'facts.sync')?.sourcePath).toBe(
      'node_modules/@open-mercato/example/src/modules/facts/commands/nested/deep.ts',
    )

    const diEntry = facts.factSources?.find((entry) => entry.kind === 'di-registration')
    expect(diEntry?.factRef?.factSection).toBe('ownedContracts.di-registration')
    expect(resolve('di-registration', diEntry?.id as string)?.sourcePath).toBe(
      'node_modules/@open-mercato/example/src/modules/facts/di.ts',
    )

    // Every emitted entry carries exactly one projection and resolves.
    for (const entry of facts.factSources ?? []) {
      expect(Boolean(entry.source) !== Boolean(entry.factRef)).toBe(true)
      expect(resolve(entry.kind, entry.id)).not.toBeNull()
    }
  })

  it('indexes every proven contract kind exactly once', () => {
    const indexed = new Set((facts.factSources ?? []).map((entry) => `${entry.kind}:${entry.id}`))
    expect(indexed.size).toBe((facts.factSources ?? []).length)
    for (const route of facts.apiRoutes) expect(indexed.has(`api-route:${route.path}`)).toBe(true)
    for (const page of facts.backendPages) expect(indexed.has(`backend-page:${page.path}`)).toBe(true)
    for (const command of facts.cliCommands) expect(indexed.has(`cli-command:${command.command}`)).toBe(true)
    for (const tool of facts.aiTools) expect(indexed.has(`ai-tool:${tool.name}`)).toBe(true)
    for (const [kind, ownedFacts] of Object.entries(facts.ownedContracts ?? {})) {
      for (const owned of ownedFacts ?? []) expect(indexed.has(`${kind}:${owned.id}`)).toBe(true)
    }
    for (const host of facts.extensionSurfaces?.hosts ?? []) {
      expect(indexed.has(`extension-host:${host.key}`)).toBe(true)
    }
    for (const contribution of facts.extensionSurfaces?.contributions ?? []) {
      expect(indexed.has(`extension-contribution:${contribution.id}`)).toBe(true)
    }
  })

  it('keeps subscriber discovery aligned with runtime recursion', () => {
    const subscriber = facts.extensionSurfaces?.contributions.find((contribution) => contribution.id === 'facts:on-created')
    expect(subscriber?.kind).toBe('subscriber')
    expect(subscriber?.source.path).toBe('node_modules/@open-mercato/example/src/modules/facts/subscribers/nested/on-created.ts')
  })

  it('attaches only statically-declared safe page metadata', () => {
    const page = facts.backendPages.find((entry) => entry.path === '/backend/facts')
    expect(page?.metadata).toEqual({ requireAuth: true, requireFeatures: ['facts.view'], navGroup: 'crm' })
  })

  it('emits portable POSIX source paths and is deterministic across runs', () => {
    const resolve = buildFactSourceLookup(facts)
    for (const entry of facts.factSources ?? []) {
      const source = resolve(entry.kind, entry.id)
      expect(source?.sourcePath.startsWith('node_modules/@open-mercato/example/')).toBe(true)
      expect(source?.sourcePath.includes('\\')).toBe(false)
    }
    const rerun = extractModuleFacts({
      moduleId: 'facts',
      moduleRoot,
      sourcePackage: '@open-mercato/example',
      sourceVersion: '1.0.0',
    })
    expect(JSON.stringify(toModuleFactsJsonEntry(rerun))).toBe(JSON.stringify(toModuleFactsJsonEntry(facts)))
  })

  it('renders new owned-contract markdown sections with clickable source links', () => {
    const markdown = renderModuleFactsMarkdown(facts)
    expect(markdown).toContain('## Domain commands')
    expect(markdown).toContain('## Workers')
    expect(markdown).toContain('## Page middleware')
    expect(markdown).toContain('## Setup')
    expect(markdown).toContain('## Encryption')
    expect(markdown).toContain('## DI registrations (rich)')
    expect(markdown).toContain('## Generator plugins')
    expect(markdown).toContain('(../../../node_modules/@open-mercato/example/src/modules/facts/di.ts')
    // Empty-content sections are omitted rather than rendered blank.
    expect(markdown).not.toMatch(/## Domain commands\n\n_none_/)
  })

  it('renders a resolved source link for every represented scalar fact', () => {
    const markdown = renderModuleFactsMarkdown(facts)
    const rowFor = (identifier: string): string => {
      const row = markdown.split('\n').find((line) => line.startsWith(`| ${identifier} |`))
      return row ?? ''
    }

    expect(markdown).toContain('| Entity ID | Class | Table | Editable | CustomFields | Source |')
    expect(rowFor('facts:facts_widget')).toContain(
      '(../../../node_modules/@open-mercato/example/src/modules/facts/data/entities.ts)',
    )

    expect(markdown).toContain('| ID | Category | Entity | Browser transport | Source |')
    expect(rowFor('facts.widget.created')).toContain(
      '(../../../node_modules/@open-mercato/example/src/modules/facts/events.ts)',
    )

    expect(markdown).toContain('| Feature | Source |')
    expect(rowFor('facts.view')).toContain('(../../../node_modules/@open-mercato/example/src/modules/facts/acl.ts)')

    expect(markdown).toContain('| Token | Source |')
    expect(markdown).toContain('| Entity ID | Source |')
    expect(markdown).toContain('| Notification ID | Source |')
    expect(rowFor('facts.alert')).toContain(
      '(../../../node_modules/@open-mercato/example/src/modules/facts/notifications.ts)',
    )

    // No represented scalar fact renders an unresolved source cell.
    const scalarSections = ['## ACL features', '## DI service tokens', '## Search entities', '## Notifications']
    for (const heading of scalarSections) {
      const section = markdown.slice(markdown.indexOf(heading)).split('\n\n')[1] ?? ''
      expect(section).not.toContain('| — |')
    }
  })

  it('renders source columns on the extension-surface sections', () => {
    const markdown = renderModuleFactsMarkdown(facts)
    expect(markdown).toContain('## Contribution resolutions')
    expect(markdown).toContain('| ID / pattern | Family | Supports | Context | Stability | Source |')
    expect(markdown).toContain('| ID | Kind | Target | Phase / operations | Contract | Resolution | Source |')
  })
})

describe('module-facts integration array/bundle coverage (Spec 1)', () => {
  let temporaryRoot: string

  afterAll(() => {
    if (temporaryRoot) fs.rmSync(temporaryRoot, { recursive: true, force: true })
  })

  it('reads singular, array, and bundle integration declarations', () => {
    temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'module-facts-integration-'))
    const moduleRoot = path.join(temporaryRoot, 'shipments')
    writeFixture(moduleRoot, 'index.ts', "export const metadata = { name: 'shipments' }\n")
    writeFixture(
      moduleRoot,
      'integration.ts',
      "export const integration = { id: 'shipments.primary' }\n"
        + "export const integrations = [{ id: 'shipments.alt' }, { id: 'shipments.legacy' }]\n"
        + "export const integrationBundle = { id: 'carriers', integrations: [{ id: 'shipments.bundled' }] }\n",
    )
    const facts = extractModuleFacts({
      moduleId: 'shipments',
      moduleRoot,
      sourcePackage: '@open-mercato/example',
      sourceVersion: '1.0.0',
    })
    const integrationIds = new Set(
      (facts.factSources ?? []).filter((entry) => entry.kind === 'integration').map((entry) => entry.id),
    )
    expect(integrationIds).toEqual(new Set(['shipments.primary', 'shipments.alt', 'shipments.legacy', 'shipments.bundled']))
  })
})
