import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { resolvePreset, generateModulesTs, applyStarterPreset } from './apply-starter-preset.js'
import type { ModuleEntry } from './starter-presets.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

// resolvePreset tests

test('resolvePreset: classic returns isClassic=true and empty modules', () => {
  const result = resolvePreset('classic')
  assert.equal(result.isClassic, true)
  assert.equal(result.id, 'classic')
  assert.deepEqual(result.modules, [])
  assert.deepEqual(result.filesToRemove, [])
})

test('resolvePreset: empty returns 12-module list', () => {
  const result = resolvePreset('empty')
  assert.equal(result.isClassic, false)
  assert.equal(result.modules.length, 12)
  const ids = result.modules.map((m) => m.id)
  assert.deepEqual(ids, [
    'auth',
    'directory',
    'configs',
    'entities',
    'query_index',
    'api_docs',
    'audit_logs',
    'notifications',
    'dashboards',
    'events',
    'search',
    'attachments',
  ])
  assert.equal(result.modules.find((m) => m.id === 'events')?.from, '@open-mercato/events')
  // search backs the Cmd+K palette the app shell renders unconditionally (issue #5164)
  assert.equal(result.modules.find((m) => m.id === 'search')?.from, '@open-mercato/search')
  // attachments owns POST /api/attachments, which the baseline directory branding page
  // uploads the organization logo through (issue #5897)
  assert.equal(result.modules.find((m) => m.id === 'attachments')?.from, '@open-mercato/core')
  assert.ok(
    result.modules
      .filter((m) => m.id !== 'events' && m.id !== 'search')
      .every((m) => m.from === '@open-mercato/core'),
  )
  // Example source stays present in every preset; it is disabled through modules.ts only.
  assert.ok(!result.filesToRemove.includes('src/modules/example'))
  assert.ok(!result.filesToRemove.includes('src/modules/example_customers_sync'))
  assert.deepEqual(result.filesToRemove, [])
})

test('resolvePreset: crm returns 23-module list extending empty (includes attachments + messages + currencies + progress + integrations + communication_channels + channel_imap + channel_gmail + ai_assistant + search)', () => {
  const result = resolvePreset('crm')
  assert.equal(result.isClassic, false)
  assert.equal(result.modules.length, 23)
  const ids = result.modules.map((m) => m.id)
  assert.ok(ids.includes('auth'))
  assert.ok(ids.includes('directory'))
  assert.ok(ids.includes('configs'))
  assert.ok(ids.includes('entities'))
  assert.ok(ids.includes('query_index'))
  assert.ok(ids.includes('api_docs'))
  assert.ok(ids.includes('audit_logs'))
  assert.ok(ids.includes('customers'))
  assert.ok(ids.includes('attachments'))
  assert.ok(ids.includes('messages'))
  assert.ok(ids.includes('dictionaries'))
  assert.ok(ids.includes('feature_toggles'))
  assert.ok(ids.includes('notifications'))
  assert.ok(ids.includes('dashboards'))
  assert.ok(ids.includes('events'))
  // currencies backs deals KPI/aggregate base-currency + FX lookups
  assert.ok(ids.includes('currencies'))
  // communication_channels backs CRM email + /backend/profile/communication-channels, but the
  // hub only persists credentials through integrations and only shows connect buttons for a
  // provider module that injects into profile:communication-channels:connect (issue #6169).
  assert.ok(ids.includes('communication_channels'))
  // progress backs communication_channels' declared `requires: ['progress']` (issue #6094)
  assert.ok(ids.includes('progress'))
  assert.ok(ids.includes('integrations'))
  assert.ok(ids.includes('channel_imap'))
  assert.equal(result.modules.find((m) => m.id === 'channel_imap')?.from, '@open-mercato/channel-imap')
  assert.ok(ids.includes('channel_gmail'))
  assert.equal(result.modules.find((m) => m.id === 'channel_gmail')?.from, '@open-mercato/channel-gmail')
  // ai_assistant must be included so customers AI widgets can register
  // (issue #1849 — CRM mode must enable AI assistant module)
  assert.ok(ids.includes('ai_assistant'))
  const aiAssistantEntry = result.modules.find((m) => m.id === 'ai_assistant')
  assert.equal(aiAssistantEntry?.from, '@open-mercato/ai-assistant')
  // search must be inherited from empty so the CRM preset gets Cmd+K next to Cmd+L
  // (issue #5164 — the palette was absent even for superadmins)
  assert.ok(ids.includes('search'))
  assert.equal(result.modules.find((m) => m.id === 'search')?.from, '@open-mercato/search')
  // Inherits filesToRemove from empty, which no longer removes the example source.
  assert.ok(!result.filesToRemove.includes('src/modules/example'))
  assert.ok(!result.filesToRemove.includes('src/modules/example_customers_sync'))
  assert.deepEqual(result.filesToRemove, [])
  // No duplicates
  const unique = new Set(ids)
  assert.equal(unique.size, ids.length)
})

test('resolvePreset: wms returns empty plus the WMS dependency chain', () => {
  const result = resolvePreset('wms')
  assert.equal(result.isClassic, false)
  assert.equal(result.modules.length, 20)
  const ids = result.modules.map((m) => m.id)
  assert.deepEqual(ids, [
    'auth',
    'directory',
    'configs',
    'entities',
    'query_index',
    'api_docs',
    'audit_logs',
    'notifications',
    'dashboards',
    'events',
    'search',
    'attachments',
    'customers',
    'progress',
    'dictionaries',
    'feature_toggles',
    'catalog',
    'sales',
    'wms',
    'currencies',
  ])
  assert.equal(result.modules.find((module) => module.id === 'wms')?.from, '@open-mercato/core')
  assert.equal(result.modules.find((module) => module.id === 'search')?.from, '@open-mercato/search')
})

test('resolvePreset: unknown preset throws', () => {
  assert.throws(() => resolvePreset('bogus'), /Unknown preset/)
})

// generateModulesTs tests

test('generateModulesTs: produces valid content for empty modules', () => {
  const emptyModules = resolvePreset('empty').modules
  const content = generateModulesTs(emptyModules)
  assert.ok(content.includes('parseBooleanWithDefault'))
  assert.ok(content.includes("id: 'auth'"))
  assert.ok(content.includes("id: 'api_docs'"))
  assert.ok(content.includes("id: 'audit_logs'"))
  assert.ok(content.includes("id: 'notifications'"))
  assert.ok(content.includes("id: 'dashboards'"))
  assert.ok(content.includes("id: 'events'"))
  assert.ok(content.includes("from: '@open-mercato/events'"))
  assert.ok(content.includes('enterpriseModulesEnabled'))
  assert.ok(!content.includes('example_customers_sync'))
  assert.ok(!content.includes("id: 'example'"))
  assert.ok(content.includes('export const enabledModules'))
  assert.ok(content.includes('export type ModuleEntry'))
})

test('generateModulesTs: produces valid content for crm modules', () => {
  const crmModules = resolvePreset('crm').modules
  const content = generateModulesTs(crmModules)
  assert.ok(content.includes("id: 'customers'"))
  assert.ok(content.includes("id: 'feature_toggles'"))
  assert.ok(content.includes("id: 'dictionaries'"))
  assert.ok(content.includes("id: 'currencies'"))
  assert.ok(content.includes("id: 'notifications'"))
  assert.ok(content.includes("id: 'dashboards'"))
  assert.ok(content.includes("id: 'events'"))
  assert.ok(content.includes("id: 'integrations'"))
  assert.ok(content.includes("id: 'communication_channels'"))
  assert.ok(content.includes("id: 'progress'"))
  assert.ok(content.includes("id: 'channel_imap'"))
  assert.ok(content.includes("id: 'channel_gmail'"))
  // ai_assistant must register from its own package
  assert.ok(content.includes("id: 'ai_assistant'"))
  assert.ok(content.includes("from: '@open-mercato/ai-assistant'"))
  assert.ok(!content.includes('example_customers_sync'))
})

test('generateModulesTs: produces valid content for wms modules', () => {
  const content = generateModulesTs(resolvePreset('wms').modules)
  for (const moduleId of ['catalog', 'sales', 'feature_toggles', 'wms', 'currencies']) {
    assert.ok(content.includes(`id: '${moduleId}'`))
  }
  assert.ok(!content.includes("id: 'ai_assistant'"))
  assert.ok(!content.includes("id: 'example'"))
})

// applyStarterPreset filesystem tests

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'preset-test-'))
  // Set up minimal structure matching what scaffoldTemplateApp produces
  mkdirSync(join(dir, 'src', 'modules', 'example'), { recursive: true })
  mkdirSync(join(dir, 'src', 'modules', 'example_customers_sync'), { recursive: true })
  mkdirSync(join(dir, '.mercato'), { recursive: true })
  writeFileSync(join(dir, 'src', 'modules.ts'), '// original')
  return dir
}

function extractExampleModuleEntry(content: string): string {
  const startMarker = "  {\n    id: 'example',"
  const endMarker = "\n  { id: 'ratelimit_probe'"
  const start = content.indexOf(startMarker)
  const end = content.indexOf(endMarker, start)

  assert.notEqual(start, -1, 'expected the Example module entry')
  assert.notEqual(end, -1, 'expected the module entry after Example')

  return content.slice(start, end)
}

test('applyStarterPreset: classic is a no-op', () => {
  const dir = makeTempDir()
  try {
    applyStarterPreset('classic', dir)
    const content = readFileSync(join(dir, 'src', 'modules.ts'), 'utf-8')
    assert.equal(content, '// original')
    assert.ok(existsSync(join(dir, 'src', 'modules', 'example')))
    assert.ok(!existsSync(join(dir, '.mercato', 'starter-preset.json')))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('applyStarterPreset: empty writes 12-module modules.ts and keeps example source present', () => {
  const dir = makeTempDir()
  try {
    applyStarterPreset('empty', dir)
    const content = readFileSync(join(dir, 'src', 'modules.ts'), 'utf-8')
    assert.ok(content.includes("id: 'auth'"))
    assert.ok(content.includes("id: 'api_docs'"))
    assert.ok(content.includes("id: 'audit_logs'"))
    assert.ok(content.includes("id: 'notifications'"))
    assert.ok(content.includes("id: 'dashboards'"))
    assert.ok(content.includes("id: 'events'"))
    assert.ok(content.includes("id: 'search'"))
    assert.ok(content.includes("from: '@open-mercato/search'"))
    // attachments must register so the branding logo upload has a route to POST to
    // (regression coverage for issue #5897)
    assert.ok(content.includes("id: 'attachments'"))
    assert.ok(!content.includes("id: 'customers'"))
    assert.ok(!content.includes('example_customers_sync'))
    assert.ok(existsSync(join(dir, 'src', 'modules', 'example')))
    assert.ok(existsSync(join(dir, 'src', 'modules', 'example_customers_sync')))
    const marker = JSON.parse(readFileSync(join(dir, '.mercato', 'starter-preset.json'), 'utf-8'))
    assert.equal(marker.preset, 'empty')
    assert.ok(typeof marker.generatedAt === 'string')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('applyStarterPreset: crm writes 23-module modules.ts and keeps example source present', () => {
  const dir = makeTempDir()
  try {
    applyStarterPreset('crm', dir)
    const content = readFileSync(join(dir, 'src', 'modules.ts'), 'utf-8')
    assert.ok(content.includes("id: 'auth'"))
    assert.ok(content.includes("id: 'customers'"))
    assert.ok(content.includes("id: 'attachments'"))
    assert.ok(content.includes("id: 'messages'"))
    assert.ok(content.includes("id: 'dictionaries'"))
    assert.ok(content.includes("id: 'feature_toggles'"))
    assert.ok(content.includes("id: 'currencies'"))
    assert.ok(content.includes("id: 'notifications'"))
    assert.ok(content.includes("id: 'dashboards'"))
    assert.ok(content.includes("id: 'events'"))
    // integrations + a connect-widget provider must register so the Communications Hub
    // can persist credentials and the profile page has connect buttons (issue #6169)
    assert.ok(content.includes("id: 'integrations'"))
    assert.ok(content.includes("id: 'communication_channels'"))
    assert.ok(content.includes("id: 'progress'"))
    assert.ok(content.includes("id: 'channel_imap'"))
    assert.ok(content.includes("from: '@open-mercato/channel-imap'"))
    assert.ok(content.includes("id: 'channel_gmail'"))
    assert.ok(content.includes("from: '@open-mercato/channel-gmail'"))
    // ai_assistant must register so customers AI widgets work in the CRM preset
    // (regression coverage for issue #1849)
    assert.ok(content.includes("id: 'ai_assistant'"))
    assert.ok(content.includes("from: '@open-mercato/ai-assistant'"))
    // search must register so Cmd+K sits beside Cmd+L (regression coverage for issue #5164)
    assert.ok(content.includes("id: 'search'"))
    assert.ok(content.includes("from: '@open-mercato/search'"))
    assert.ok(!content.includes('example_customers_sync'))
    assert.ok(existsSync(join(dir, 'src', 'modules', 'example')))
    assert.ok(existsSync(join(dir, 'src', 'modules', 'example_customers_sync')))
    const marker = JSON.parse(readFileSync(join(dir, '.mercato', 'starter-preset.json'), 'utf-8'))
    assert.equal(marker.preset, 'crm')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('applyStarterPreset: wms writes the WMS dependency chain and keeps example source present', () => {
  const dir = makeTempDir()
  try {
    applyStarterPreset('wms', dir)
    const content = readFileSync(join(dir, 'src', 'modules.ts'), 'utf-8')
    for (const moduleId of ['customers', 'progress', 'dictionaries', 'feature_toggles', 'catalog', 'sales', 'wms', 'currencies']) {
      assert.ok(content.includes(`id: '${moduleId}'`))
    }
    // catalog's product media manager uploads through POST /api/attachments, which only
    // the inherited attachments module registers (issue #5897)
    assert.ok(content.includes("id: 'attachments'"))
    assert.ok(!content.includes("id: 'ai_assistant'"))
    assert.ok(existsSync(join(dir, 'src', 'modules', 'example')))
    const marker = JSON.parse(readFileSync(join(dir, '.mercato', 'starter-preset.json'), 'utf-8'))
    assert.equal(marker.preset, 'wms')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// Drift guard: the app shell's topbar renders each affordance on an ACL feature, and
// `filterGrantsByEnabledModules` strips any feature whose owning module is not in the
// enabled-modules registry — for every role, superadmin included. A preset that omits
// such a module therefore ships an app where the affordance is silently absent rather
// than 403-ing, which is exactly how issue #5164 escaped review.

function readTopbarGatedModuleIds(): string[] {
  const chrome = readFileSync(
    join(__dirname, '..', '..', 'template', 'src', 'components', 'BackendHeaderChrome.tsx'),
    'utf-8',
  )
  const featureIds = [...chrome.matchAll(/hasFeature\(grantedFeatures,\s*'([^']+)'\)/g)].map((m) => m[1])
  assert.ok(
    featureIds.length >= 3,
    'expected the template topbar to gate at least the AI assistant, global search and notification affordances',
  )
  // Every feature id in this codebase is `<moduleId>.<rest>`, so the owning module is
  // the segment before the first dot.
  return [...new Set(featureIds.map((featureId) => featureId.split('.')[0]))]
}

test('every non-classic preset enables the modules the template topbar gates on', () => {
  const requiredModuleIds = readTopbarGatedModuleIds()
  assert.ok(requiredModuleIds.includes('search'))
  assert.ok(requiredModuleIds.includes('notifications'))

  for (const presetId of ['empty', 'crm', 'wms']) {
    const enabledIds = new Set(resolvePreset(presetId).modules.map((m) => m.id))
    for (const moduleId of requiredModuleIds) {
      // ai_assistant is a CRM capability rather than baseline chrome, so the empty
      // and WMS presets are allowed to omit it; every other gated module must be present.
      if (moduleId === 'ai_assistant' && ['empty', 'wms'].includes(presetId)) continue
      assert.ok(
        enabledIds.has(moduleId),
        `preset "${presetId}" must enable module "${moduleId}" — the topbar gates an affordance on one of its features`,
      )
    }
  }
})

// Drift guard: a preset that enables a module whose UI uploads through
// `POST /api/attachments` without also enabling `attachments` ships an app where the
// route is simply not registered, so the upload answers 404 while the rest of the page
// keeps working. That silent failure is how issue #5897 escaped review — the baseline
// `directory` branding page has always uploaded the organization logo that way.

const PACKAGES_DIR = join(__dirname, '..', '..', '..')

// Every module a preset can enable lives at `packages/<pkg>/src/modules/<id>`, so the
// owning package is derivable from the entry's `from` — scanning only `@open-mercato/core`
// would leave a preset that enables an uploader from `search`, `events` or `ai-assistant`
// unguarded.
function moduleSourceDir(entry: ModuleEntry): string {
  return join(PACKAGES_DIR, entry.from.replace('@open-mercato/', ''), 'src', 'modules', entry.id)
}

function collectSourceFiles(dir: string): string[] {
  const skipped = new Set(['__tests__', '__integration__', 'migrations', 'node_modules'])
  const files: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (skipped.has(entry.name)) continue
      files.push(...collectSourceFiles(join(dir, entry.name)))
      continue
    }
    if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) files.push(join(dir, entry.name))
  }
  return files
}

const attachmentUploaderCache = new Map<string, boolean>()

function moduleUploadsToAttachments(entry: ModuleEntry): boolean {
  const cached = attachmentUploaderCache.get(entry.id)
  if (cached !== undefined) return cached
  const moduleDir = moduleSourceDir(entry)
  const uploads =
    existsSync(moduleDir) &&
    collectSourceFiles(moduleDir).some((file) =>
      readFileSync(file, 'utf-8').includes("'/api/attachments'"),
    )
  attachmentUploaderCache.set(entry.id, uploads)
  return uploads
}

test('every non-classic preset enabling an attachment uploader also enables attachments', () => {
  // The guard is only meaningful while a baseline module really does upload; assert that
  // premise so a future refactor turns this test red rather than vacuously green.
  assert.ok(
    moduleUploadsToAttachments({ id: 'directory', from: '@open-mercato/core' }),
    'expected the directory branding page to upload the organization logo to /api/attachments',
  )

  for (const presetId of ['empty', 'crm', 'wms']) {
    const modules = resolvePreset(presetId).modules
    const enabledIds = new Set(modules.map((m) => m.id))
    const uploaders = modules
      .filter((m) => m.id !== 'attachments')
      .filter(moduleUploadsToAttachments)
      .map((m) => m.id)
    if (uploaders.length === 0) continue
    assert.ok(
      enabledIds.has('attachments'),
      `preset "${presetId}" enables ${uploaders.join(', ')} — module(s) uploading through POST /api/attachments — but not the attachments module that registers the route`,
    )
  }
})

test('any preset enabling ai_assistant also enables search', () => {
  for (const presetId of ['classic', 'empty', 'crm', 'wms']) {
    const resolved = resolvePreset(presetId)
    if (resolved.isClassic) continue
    const ids = new Set(resolved.modules.map((m) => m.id))
    if (!ids.has('ai_assistant')) continue
    assert.ok(
      ids.has('search'),
      `preset "${presetId}" enables ai_assistant (Cmd+L) but not search (Cmd+K); the two palettes ship as a pair`,
    )
  }
})

// Drift guard: `ModuleInfo.requires` is enforced by the generator at `yarn generate`
// time (packages/cli/src/lib/generators/module-registry.ts:4222), so a preset whose
// module set does not satisfy it produces an app that hard-fails on the very first
// command the CLI prints. Issue #6094 is how that escaped review — no test runs the
// generator against a non-classic preset.
function declaredRequires(entry: ModuleEntry): string[] {
  const indexFile = join(moduleSourceDir(entry), 'index.ts')
  if (!existsSync(indexFile)) return []
  const match = readFileSync(indexFile, 'utf-8').match(/requires:\s*\[([^\]]*)\]/)
  if (!match) return []
  return [...match[1].matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1])
}

test('every non-classic preset satisfies the declared `requires` of every module it enables', () => {
  // Premise assertion, so a future refactor turns this red rather than vacuously green.
  assert.deepEqual(
    declaredRequires({ id: 'communication_channels', from: '@open-mercato/core' }),
    ['progress'],
  )

  for (const presetId of ['empty', 'crm', 'wms']) {
    const modules = resolvePreset(presetId).modules
    const enabledIds = new Set(modules.map((m) => m.id))
    for (const entry of modules) {
      const missing = declaredRequires(entry).filter((id) => !enabledIds.has(id))
      assert.deepEqual(
        missing,
        [],
        `preset "${presetId}" enables "${entry.id}", which declares requires: [${declaredRequires(entry).join(', ')}] — ` +
          `${missing.join(', ')} is not in the preset, so \`yarn generate\` fails with "Module dependency check failed"`,
      )
    }
  }
})

// Drift guard: a preset that enables `communication_channels` without also enabling
// `integrations` (which registers `integrationCredentialsService`) and at least one module
// that injects a connect button into the profile page's spot ships an app where the
// Communications Hub renders with no way to ever connect a channel — that silent gap is how
// issue #6169 escaped review.

const CONNECT_SPOT = 'profile:communication-channels:connect'

function moduleInjectsIntoSpot(entry: ModuleEntry, spotId: string): boolean {
  const injectionTable = join(moduleSourceDir(entry), 'widgets', 'injection-table.ts')
  return existsSync(injectionTable) && readFileSync(injectionTable, 'utf-8').includes(`'${spotId}'`)
}

test('any preset enabling communication_channels also enables integrations and a connect-widget provider', () => {
  // The guard is only meaningful while a real provider really does inject a connect button;
  // assert that premise so a future refactor turns this test red rather than vacuously green.
  assert.ok(
    moduleInjectsIntoSpot({ id: 'channel_imap', from: '@open-mercato/channel-imap' }, CONNECT_SPOT),
    `expected channel_imap to inject a connect button into "${CONNECT_SPOT}"`,
  )

  for (const presetId of ['empty', 'crm', 'wms']) {
    const modules = resolvePreset(presetId).modules
    const ids = new Set(modules.map((m) => m.id))
    if (!ids.has('communication_channels')) continue
    assert.ok(
      ids.has('integrations'),
      `preset "${presetId}" enables communication_channels but not integrations — the hub can't persist channel credentials without integrationCredentialsService`,
    )
    const providers = modules.filter((m) => moduleInjectsIntoSpot(m, CONNECT_SPOT)).map((m) => m.id)
    assert.ok(
      providers.length > 0,
      `preset "${presetId}" enables communication_channels but no enabled module injects a connect button into "${CONNECT_SPOT}" — the profile page has no way to connect a channel`,
    )
  }
})

test('template baseline modules keep example and design_system unregistered for classic', () => {
  const content = readFileSync(join(__dirname, '..', '..', 'template', 'src', 'modules.ts'), 'utf-8')

  assert.ok(!content.includes("id: 'example',"))
  assert.ok(!content.includes("id: 'design_system'"))
  // example_customers_sync stays behind the example guard, so it is inert too.
  assert.ok(content.includes("enabledModules.some((entry) => entry.id === 'example')"))
  assert.ok(content.includes("enabledModules.push({ id: 'example_customers_sync', from: '@app' })"))
})

test('template baseline installs every enabled Documents package', () => {
  const templateRoot = join(__dirname, '..', '..', 'template')
  const modulesSource = readFileSync(join(templateRoot, 'src', 'modules.ts'), 'utf-8')
  const nextConfigSource = readFileSync(join(templateRoot, 'next.config.ts'), 'utf-8')
  const packageTemplate = JSON.parse(readFileSync(join(templateRoot, 'package.json.template'), 'utf-8')) as {
    dependencies?: Record<string, string>
    scripts?: Record<string, string>
  }
  const environmentTemplate = readFileSync(join(templateRoot, '.env.example'), 'utf-8')
  const dockerfile = readFileSync(join(templateRoot, 'Dockerfile'), 'utf-8')
  const fullAppCompose = readFileSync(join(templateRoot, 'docker-compose.fullapp.yml'), 'utf-8')

  assert.ok(modulesSource.includes("{ id: 'documents', from: '@open-mercato/documents' }"))
  assert.equal(packageTemplate.dependencies?.['@open-mercato/documents'], '{{PACKAGE_VERSION}}')
  assert.equal(
    packageTemplate.scripts?.['documents:collab'],
    'node ./node_modules/@open-mercato/documents/dist/server/documents-collab-server.js',
  )
  assert.match(nextConfigSource, /serverExternalPackages:[\s\S]*'puppeteer-core'/)
  assert.match(nextConfigSource, /serverExternalPackages:[\s\S]*'jszip'/)
  assert.match(environmentTemplate, /^NEXT_PUBLIC_DOCUMENTS_COLLAB_URL=/m)
  assert.match(environmentTemplate, /^DOCUMENTS_COLLAB_JWT_SECRET_V2=$/m)
  assert.match(environmentTemplate, /^DOCUMENTS_COLLAB_ALLOWED_ORIGINS=/m)
  assert.match(dockerfile, /^ARG NEXT_PUBLIC_DOCUMENTS_COLLAB_URL$/m)
  assert.doesNotMatch(dockerfile, /RUN node -e '[^']*NEXT_PUBLIC_DOCUMENTS_COLLAB_URL/)
  assert.doesNotMatch(dockerfile, /ARG NEXT_PUBLIC_DOCUMENTS_COLLAB_URL=ws:\/\/localhost:4101/)
  assert.match(dockerfile, /ENV NEXT_PUBLIC_DOCUMENTS_COLLAB_URL=\$\{NEXT_PUBLIC_DOCUMENTS_COLLAB_URL\}/)
  assert.match(dockerfile, /EXPOSE \$\{CONTAINER_PORT\} \$\{DOCUMENTS_COLLAB_PORT\}/)
  assert.match(dockerfile, /PUPPETEER_EXECUTABLE_PATH=\/usr\/bin\/chromium/)
  assert.match(dockerfile, /ARG INSTALL_CHROMIUM=0/)
  assert.match(dockerfile, /if \[ "\$INSTALL_CHROMIUM" = "1" \]/)
  assert.match(dockerfile, /apk add --no-cache ca-certificates chromium openssl/)
  assert.match(
    fullAppCompose,
    /NEXT_PUBLIC_DOCUMENTS_COLLAB_URL=\$\{NEXT_PUBLIC_DOCUMENTS_COLLAB_URL:-\}/,
  )
  assert.doesNotMatch(fullAppCompose, /NEXT_PUBLIC_DOCUMENTS_COLLAB_URL[^\n]*:-ws:\/\/localhost/)
  assert.match(
    fullAppCompose,
    /DOCUMENTS_COLLAB_JWT_SECRET_V2: \$\{DOCUMENTS_COLLAB_JWT_SECRET_V2:-\}/,
  )
  assert.doesNotMatch(fullAppCompose, /change-me-documents-collab-v2-secret/)
  assert.doesNotMatch(fullAppCompose, /DOCUMENTS_COLLAB[^\n]*\$\{[^}]*:\?/)
  assert.match(fullAppCompose, /APP_URL: \$\{APP_URL:-http:\/\/localhost:3000\}/)
  assert.match(
    fullAppCompose,
    /DOCUMENTS_COLLAB_ALLOWED_ORIGINS: \$\{DOCUMENTS_COLLAB_ALLOWED_ORIGINS:-\$\{APP_URL\}\}/,
  )
  assert.doesNotMatch(fullAppCompose, /DOCUMENTS_COLLAB_ALLOWED_ORIGINS[^\n]*localhost/)
  assert.match(fullAppCompose, /documents-collab:[\s\S]*command: \["yarn", "documents:collab"\]/)
  assert.match(fullAppCompose, /documents-collab:\s*\n\s+profiles:\s*\n\s+- documents-collab/)
  assert.match(fullAppCompose, /INSTALL_CHROMIUM=\$\{INSTALL_CHROMIUM:-0\}/)
})

test('production image does not abort for a misconfigured collaboration endpoint', () => {
  const dockerfile = readFileSync(
    join(__dirname, '..', '..', 'template', 'Dockerfile'),
    'utf-8',
  )

  assert.match(dockerfile, /^ARG NEXT_PUBLIC_DOCUMENTS_COLLAB_URL$/m)
  assert.match(dockerfile, /ENV NEXT_PUBLIC_DOCUMENTS_COLLAB_URL=\$\{NEXT_PUBLIC_DOCUMENTS_COLLAB_URL\}/)
  assert.doesNotMatch(dockerfile, /RUN node -e '[^']*NEXT_PUBLIC_DOCUMENTS_COLLAB_URL/)
})

test('monorepo keeps the applied Example nav override integration-only', () => {
  const monorepoContent = readFileSync(join(__dirname, '..', '..', '..', '..', 'apps', 'mercato', 'src', 'modules.ts'), 'utf-8')
  const monorepoEntry = extractExampleModuleEntry(monorepoContent)

  assert.match(
    monorepoEntry,
    /nav:\s*parseBooleanWithDefault\(process\.env\.OM_INTEGRATION_TEST, false\)\s*\?\s*\{ groupOrder: \['example\.nav\.group'\] \}\s*:\s*undefined/,
  )
  assert.doesNotMatch(monorepoEntry, /nav:\s*\{\s*groupOrder:/)
})
