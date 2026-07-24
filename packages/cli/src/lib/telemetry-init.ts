import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

/**
 * `mercato telemetry init` — wire `@open-mercato/telemetry` into an app that was
 * scaffolded before telemetry existed. Deterministic, idempotent, and safe to
 * re-run: each step detects whether it is already applied and skips.
 *
 * The web-tier wiring lives in app-owned source files (a dependency bump cannot
 * touch them), so this patches them in place using the same idioms the rest of
 * the CLI uses: JSON edits, detect-before-append for `.env`, a ts-morph edit for
 * `next.config.ts`, and anchored insertion for `instrumentation.ts` + the API
 * dispatcher. When a file's shape is not recognized (a customized dispatcher, an
 * unusual next.config), the step degrades to printing the exact snippet and
 * flags it as a manual step rather than editing code it does not understand.
 *
 * Worker/scheduler telemetry is not handled here — it ships transitively via
 * `@open-mercato/cli`'s telemetry dependency once the app updates its packages.
 */

const BULLMQ_OTEL_VERSION = '^1.3.1'

type StepStatus = 'created' | 'patched' | 'skipped' | 'manual'

type StepResult = {
  file: string
  status: StepStatus
  detail: string
  /** Snippet to show when the step needs manual work. */
  manualSnippet?: string
}

type TelemetryInitOptions = {
  dryRun: boolean
}

const ENV_BLOCK = `
# --- Telemetry & Observability (vendor-neutral OTLP: traces, logs, metrics, errors) ---
# Off by default: leave TELEMETRY_BACKEND unset (or =noop) for a hard no-op
# (the OpenTelemetry SDK is never loaded). Set to 'console' for local span/metric
# output, or an OTLP backend to export: 'signoz' | 'newrelic' | 'otlp' (generic).
# All three OTLP names use the same exporter — they differ only by the endpoint +
# headers below. Any OTLP backend is a one-line swap; no code change.
# TELEMETRY_BACKEND=otlp
# Logs use the shared logger facade and its OM_LOG_LEVEL / OM_LOG_PRETTY /
# OM_LOG_DESTINATION controls. Telemetry adds remote export; it does not create
# a second local output path.
# TELEMETRY_SAMPLING_RATIO=1.0        # 0.0–1.0 (default 1.0 dev / 0.1 prod)
# TELEMETRY_TRUST_INBOUND_TRACE=false # default false: root-per-request (ignore an
#                                     # inbound traceparent from a proxy/LB). Set true
#                                     # only behind a trusted upstream whose trace continues.
#
# OTLP endpoint + auth — pick ONE vendor (use your region's host):
#   SigNoz Cloud:
# OTEL_EXPORTER_OTLP_ENDPOINT=https://ingest.<region>.signoz.cloud:443
# OTEL_EXPORTER_OTLP_HEADERS=signoz-ingestion-key=<your-ingestion-key>
#   New Relic (OTLP-native; EU host shown, US is https://otlp.nr-data.net):
# OTEL_EXPORTER_OTLP_ENDPOINT=https://otlp.eu01.nr-data.net
# OTEL_EXPORTER_OTLP_HEADERS=api-key=<your-ingest-license-key>
#
# Resource identity: keep one stable service name across environments and
# separate envs via the deployment.environment resource attribute.
# OTEL_SERVICE_NAME=open-mercato
# OTEL_RESOURCE_ATTRIBUTES=deployment.environment=local
`

const INSTRUMENTATION_TS = `import { isTelemetryBackendEnabled } from '@open-mercato/shared/lib/telemetry/runtime'

export async function register(): Promise<void> {
  // Initialize telemetry (no-op unless TELEMETRY_BACKEND is set). OTEL's NodeSDK
  // is Node-only and incompatible with the edge runtime, so the telemetry
  // bootstrap — which can pull in the SDK — is imported only on the Node.js
  // runtime. The helper owns init + graceful degrade + shutdown flush.
  if (
    process.env.NEXT_RUNTIME === 'nodejs'
    && isTelemetryBackendEnabled()
  ) {
    const { registerTelemetryForNextjs } = await import('@open-mercato/telemetry/nextjs')
    await registerTelemetryForNextjs()
  }
}
`

const DISPATCHER_SNIPPET = `  // add near the other imports:
  import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'

  // in the dispatcher's success path, just before returning the response:
  getTelemetryRuntime()?.recordHttpDuration(method, match.route.path, finalResponse.status, startedAt)

  // in the dispatcher's catch (error) block, before re-throwing:
  getTelemetryRuntime()?.reportError(error, {
    attributes: { 'http.request.method': method, 'http.route': match.route.path, 'http.response.status_code': 500 },
  })
  getTelemetryRuntime()?.recordHttpDuration(method, match.route.path, 500, startedAt)`

function parseArgs(args: string[]): TelemetryInitOptions {
  return {
    dryRun: args.includes('--dry-run') || args.includes('-n'),
  }
}

/** Read the version an app already pins its `@open-mercato/*` deps to (lockstep). */
function resolveOpenMercatoVersion(pkg: Record<string, unknown>): string {
  for (const field of ['dependencies', 'devDependencies'] as const) {
    const deps = pkg[field]
    if (deps && typeof deps === 'object') {
      for (const [name, version] of Object.entries(deps as Record<string, string>)) {
        if (name.startsWith('@open-mercato/') && typeof version === 'string') return version
      }
    }
  }
  return '*'
}

function patchPackageJson(appDir: string, options: TelemetryInitOptions): StepResult {
  const file = 'package.json'
  const path = join(appDir, file)
  const raw = readFileSync(path, 'utf8')
  const pkg = JSON.parse(raw) as {
    dependencies?: Record<string, string>
    optionalDependencies?: Record<string, string>
  }
  const version = resolveOpenMercatoVersion(pkg)
  const hasTelemetry = Boolean(pkg.dependencies?.['@open-mercato/telemetry'])
  const hasBullmqOtel = Boolean(pkg.optionalDependencies?.['bullmq-otel'])
  if (hasTelemetry && hasBullmqOtel) {
    return { file, status: 'skipped', detail: '@open-mercato/telemetry already installed' }
  }

  const deps = { ...(pkg.dependencies ?? {}) }
  if (!hasTelemetry) deps['@open-mercato/telemetry'] = version
  const optDeps = { ...(pkg.optionalDependencies ?? {}) }
  if (!hasBullmqOtel) optDeps['bullmq-otel'] = BULLMQ_OTEL_VERSION

  const next = {
    ...pkg,
    dependencies: sortRecord(deps),
    optionalDependencies: sortRecord(optDeps),
  }
  if (!options.dryRun) writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`)
  return {
    file,
    status: 'patched',
    detail: `+@open-mercato/telemetry@${version}${hasBullmqOtel ? '' : ` +bullmq-otel@${BULLMQ_OTEL_VERSION} (optional)`} — run \`yarn install\``,
  }
}

function sortRecord(record: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)))
}

function patchEnvFile(appDir: string, relativePath: string, options: TelemetryInitOptions): StepResult | null {
  const path = join(appDir, relativePath)
  if (!existsSync(path)) return null
  const content = readFileSync(path, 'utf8')
  if (content.includes('TELEMETRY_BACKEND')) {
    return { file: relativePath, status: 'skipped', detail: 'TELEMETRY_* block already present' }
  }
  const next = `${content.replace(/\s*$/, '')}\n${ENV_BLOCK}`
  if (!options.dryRun) writeFileSync(path, next)
  return { file: relativePath, status: 'patched', detail: 'appended commented TELEMETRY_* / OTEL_* block' }
}

function patchInstrumentation(appDir: string, options: TelemetryInitOptions): StepResult {
  const file = 'src/instrumentation.ts'
  const path = join(appDir, file)
  if (!existsSync(path)) {
    if (!options.dryRun) {
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, INSTRUMENTATION_TS)
    }
    return { file, status: 'created', detail: 'Node-runtime-guarded registerTelemetryForNextjs() bootstrap' }
  }
  const content = readFileSync(path, 'utf8')
  if (content.includes('registerTelemetryForNextjs')) {
    if (content.includes('isTelemetryBackendEnabled')) {
      return { file, status: 'skipped', detail: 'telemetry already wired' }
    }
    const migrated =
      `import { isTelemetryBackendEnabled } from '@open-mercato/shared/lib/telemetry/runtime'\n` +
      content.replace(
        `if (process.env.NEXT_RUNTIME === 'nodejs') {`,
        `if (process.env.NEXT_RUNTIME === 'nodejs' && isTelemetryBackendEnabled()) {`,
      )
    if (!options.dryRun) writeFileSync(path, migrated)
    return { file, status: 'patched', detail: 'added the explicit backend import guard' }
  }
  const anchor = content.match(/export\s+async\s+function\s+register\s*\([^)]*\)\s*:\s*Promise<void>\s*\{/)
  if (!anchor || anchor.index === undefined) {
    return {
      file,
      status: 'manual',
      detail: 'register() not found — add the telemetry bootstrap manually',
      manualSnippet: INSTRUMENTATION_TS,
    }
  }
  const insertAt = anchor.index + anchor[0].length
  const block =
    `\n  // Initialize telemetry (no-op unless TELEMETRY_BACKEND is set); Node-only.` +
    `\n  if (process.env.NEXT_RUNTIME === 'nodejs' && isTelemetryBackendEnabled()) {` +
    `\n    const { registerTelemetryForNextjs } = await import('@open-mercato/telemetry/nextjs')` +
    `\n    await registerTelemetryForNextjs()` +
    `\n  }`
  const importLine = `import { isTelemetryBackendEnabled } from '@open-mercato/shared/lib/telemetry/runtime'\n`
  const withImport = content.includes('isTelemetryBackendEnabled')
    ? content
    : importLine + content
  const shiftedInsertAt = insertAt + (withImport.length - content.length)
  const next = withImport.slice(0, shiftedInsertAt) + block + withImport.slice(shiftedInsertAt)
  if (!options.dryRun) writeFileSync(path, next)
  return { file, status: 'patched', detail: 'inserted registerTelemetryForNextjs() into register()' }
}

async function patchNextConfig(appDir: string, options: TelemetryInitOptions): Promise<StepResult> {
  const file = 'next.config.ts'
  const path = join(appDir, file)
  if (!existsSync(path)) {
    return { file, status: 'manual', detail: 'next.config.ts not found', manualSnippet: nextConfigSnippet() }
  }
  // Use ts-morph to *detect* the real `serverExternalPackages` array literal
  // (robust against a match inside a comment/string), then do the *insertion*
  // via a formatting-preserving text splice so the user's config stays tidy.
  const { Project, SyntaxKind } = await import('ts-morph')
  const project = new Project({ skipAddingFilesFromTsConfig: true, skipFileDependencyResolution: true })
  const sf = project.addSourceFileAtPath(path)

  const telemetryConfigImport = sf
    .getImportDeclarations()
    .find((decl) => [
      '@open-mercato/telemetry/nextjs',
      '@open-mercato/telemetry/nextjs-config',
    ].includes(decl.getModuleSpecifierValue()))
  const hasImport = Boolean(telemetryConfigImport)
  const hasCanonicalImport =
    telemetryConfigImport?.getModuleSpecifierValue() === '@open-mercato/telemetry/nextjs-config'

  const arrayProp = sf
    .getDescendantsOfKind(SyntaxKind.PropertyAssignment)
    .find((prop) => prop.getName() === 'serverExternalPackages')
  const arrayInit = arrayProp?.getInitializerIfKind(SyntaxKind.ArrayLiteralExpression)
  if (!arrayInit) {
    return {
      file,
      status: 'manual',
      detail: 'serverExternalPackages array not found',
      manualSnippet: nextConfigSnippet(),
    }
  }
  const hasSpread = arrayInit.getElements().some((el) => el.getText().includes('telemetryServerExternalPackages'))
  if (hasCanonicalImport && hasSpread) {
    return { file, status: 'skipped', detail: 'telemetryServerExternalPackages already wired' }
  }

  let text = readFileSync(path, 'utf8')
  text = text.replace(
    "from '@open-mercato/telemetry/nextjs'",
    "from '@open-mercato/telemetry/nextjs-config'",
  )
  // Splice the array first, using the AST node's byte offsets (formatting-agnostic:
  // handles both single-line and multi-line arrays). Do this before the import
  // insert, which shifts earlier offsets.
  if (!hasSpread) {
    const start = arrayInit.getStart()
    const end = arrayInit.getEnd()
    text = text.slice(0, start) + insertSpread(text.slice(start, end)) + text.slice(end)
  }
  if (!hasImport) {
    const importRegex = /^import[^\n]*$/gm
    let lastImport: RegExpExecArray | null = null
    let match: RegExpExecArray | null
    while ((match = importRegex.exec(text)) !== null) lastImport = match
    const insertAt = lastImport ? lastImport.index + lastImport[0].length : 0
    text =
      text.slice(0, insertAt) +
      `\nimport { telemetryServerExternalPackages } from '@open-mercato/telemetry/nextjs-config'` +
      text.slice(insertAt)
  }
  if (!options.dryRun) writeFileSync(path, text)
  return { file, status: 'patched', detail: 'spread telemetryServerExternalPackages into serverExternalPackages' }
}

/** Add `...telemetryServerExternalPackages` as the last element of an array literal, preserving its style. */
function insertSpread(arrayText: string): string {
  const inner = arrayText.slice(1, -1)
  if (inner.includes('\n')) {
    const elementIndent = inner.match(/\n([ \t]+)\S/)?.[1] ?? '  '
    const closeIndent = arrayText.match(/\n([ \t]*)\]$/)?.[1] ?? ''
    const trimmed = inner.replace(/\s*$/, '')
    const separator = trimmed === '' || trimmed.endsWith(',') ? '' : ','
    return `[${trimmed}${separator}\n${elementIndent}...telemetryServerExternalPackages,\n${closeIndent}]`
  }
  const flat = inner.trim()
  return flat === '' ? '[...telemetryServerExternalPackages]' : `[${flat}, ...telemetryServerExternalPackages]`
}

function nextConfigSnippet(): string {
  return (
    `import { telemetryServerExternalPackages } from '@open-mercato/telemetry/nextjs-config'\n` +
    `// serverExternalPackages: [ ...existing, ...telemetryServerExternalPackages ]`
  )
}

/**
 * Auto-patch the catch-all API dispatcher — but only when it still matches the
 * known scaffold shape (all anchors present, telemetry not yet wired). On any
 * mismatch, print the snippet and mark it manual rather than editing an
 * unrecognized (customized) handler.
 */
function patchDispatcher(appDir: string, options: TelemetryInitOptions): StepResult {
  const file = 'src/app/api/[...slug]/route.ts'
  const path = join(appDir, file)
  if (!existsSync(path)) {
    return { file, status: 'manual', detail: 'dispatcher not found', manualSnippet: DISPATCHER_SNIPPET }
  }
  let content = readFileSync(path, 'utf8')
  if (
    content.includes("from '@open-mercato/shared/lib/telemetry/runtime'")
    && content.includes('getTelemetryRuntime()?.recordHttpDuration')
  ) {
    return { file, status: 'skipped', detail: 'telemetry already wired' }
  }
  if (
    content.includes("import { reportError } from '@open-mercato/telemetry'")
    && content.includes("import { recordHttpDuration } from '@open-mercato/telemetry/nextjs'")
  ) {
    content = content
      .replace(
        "import { reportError } from '@open-mercato/telemetry'\nimport { recordHttpDuration } from '@open-mercato/telemetry/nextjs'",
        "import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'",
      )
      .replace(/\brecordHttpDuration\(/g, 'getTelemetryRuntime()?.recordHttpDuration(')
      .replace(/\breportError\(/g, 'getTelemetryRuntime()?.reportError(')
    if (!options.dryRun) writeFileSync(path, content)
    return { file, status: 'patched', detail: 'migrated dispatcher to the default-off runtime bridge' }
  }

  const importAnchor = "import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'"
  const returnMatch = content.match(/^([ \t]*)return finalResponse\s*$/m)
  // The handleRequest catch is the first `} catch (error) {` after the success return.
  const catchRegex = /^([ \t]*)\}\s*catch\s*\(error\)\s*\{[ \t]*$/gm
  const catchMatch = findCatchAfter(content, catchRegex, returnMatch?.index ?? -1)

  if (!content.includes(importAnchor) || !returnMatch || returnMatch.index === undefined || !catchMatch) {
    return {
      file,
      status: 'manual',
      detail: 'dispatcher shape not recognized — apply the snippet by hand',
      manualSnippet: DISPATCHER_SNIPPET,
    }
  }

  // 1) imports
  content = content.replace(
    importAnchor,
    `${importAnchor}\nimport { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'`,
  )

  // 2) success-path metric (re-match after the import edit shifted offsets)
  const ret = content.match(/^([ \t]*)return finalResponse\s*$/m)
  if (!ret || ret.index === undefined) {
    return { file, status: 'manual', detail: 'success-path anchor lost', manualSnippet: DISPATCHER_SNIPPET }
  }
  const retIndent = ret[1]
  content =
    content.slice(0, ret.index) +
    `${retIndent}getTelemetryRuntime()?.recordHttpDuration(method, match.route.path, finalResponse.status, startedAt)\n` +
    content.slice(ret.index)

  // 3) catch-block error funnel + 500 metric
  const catch2 = findCatchAfter(content, /^([ \t]*)\}\s*catch\s*\(error\)\s*\{[ \t]*$/gm, content.indexOf('return finalResponse'))
  if (!catch2) {
    return { file, status: 'manual', detail: 'catch anchor lost', manualSnippet: DISPATCHER_SNIPPET }
  }
  const bodyIndent = `${catch2.indent}  `
  const insertAt = catch2.index + catch2.length
  const block =
    `\n${bodyIndent}getTelemetryRuntime()?.reportError(error, {` +
    `\n${bodyIndent}  attributes: { 'http.request.method': method, 'http.route': match.route.path, 'http.response.status_code': 500 },` +
    `\n${bodyIndent}})` +
    `\n${bodyIndent}getTelemetryRuntime()?.recordHttpDuration(method, match.route.path, 500, startedAt)`
  content = content.slice(0, insertAt) + block + content.slice(insertAt)

  if (!options.dryRun) writeFileSync(path, content)
  return { file, status: 'patched', detail: 'wired reportError (5xx) + http.server.request.duration metric' }
}

function findCatchAfter(
  content: string,
  regex: RegExp,
  afterIndex: number,
): { index: number; length: number; indent: string } | null {
  regex.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = regex.exec(content)) !== null) {
    if (match.index > afterIndex) {
      return { index: match.index, length: match[0].length, indent: match[1] }
    }
  }
  return null
}

export async function runTelemetryInit(args: string[]): Promise<number> {
  const appDir = resolve('.')
  const options = parseArgs(args)

  if (!existsSync(join(appDir, 'src', 'modules.ts'))) {
    console.error('❌  Not an Open Mercato app directory (src/modules.ts not found)')
    return 1
  }
  if (!existsSync(join(appDir, 'package.json'))) {
    console.error('❌  package.json not found')
    return 1
  }

  console.log('')
  console.log(options.dryRun ? '🔭 Telemetry init (dry run — no files written)\n' : '🔭 Wiring @open-mercato/telemetry into this app\n')

  const results: StepResult[] = []
  results.push(patchPackageJson(appDir, options))
  const envExample = patchEnvFile(appDir, '.env.example', options)
  if (envExample) results.push(envExample)
  const env = patchEnvFile(appDir, '.env', options)
  if (env) results.push(env)
  results.push(patchInstrumentation(appDir, options))
  results.push(await patchNextConfig(appDir, options))
  results.push(patchDispatcher(appDir, options))

  const icon: Record<StepStatus, string> = { created: '✍️ ', patched: '✅', skipped: '⏭️ ', manual: '⚠️ ' }
  for (const result of results) {
    console.log(`${icon[result.status]} ${result.file} — ${result.detail}`)
  }

  const manual = results.filter((result) => result.status === 'manual')
  for (const result of manual) {
    if (!result.manualSnippet) continue
    console.log('')
    console.log(`── manual step for ${result.file} ──`)
    console.log(result.manualSnippet)
  }

  console.log('')
  const changed = results.some((result) => result.status === 'patched' || result.status === 'created')
  if (options.dryRun) {
    console.log('Dry run complete — re-run without --dry-run to apply.')
  } else if (changed) {
    console.log('Next steps:')
    console.log('  1. yarn install                 (resolve @open-mercato/telemetry + the OTEL SDK)')
    console.log('  2. set TELEMETRY_BACKEND + OTEL_EXPORTER_OTLP_* in .env')
    console.log('  3. yarn typecheck && yarn build (verify the wiring)')
  } else {
    console.log('Nothing to do — telemetry is already wired.')
  }
  if (manual.length > 0) {
    console.log('')
    console.log(`⚠️  ${manual.length} file(s) need a manual edit (shown above) — the rest were applied automatically.`)
  }
  return 0
}
