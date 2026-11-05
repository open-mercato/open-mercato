import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const TEMPLATE_DIR = new URL('../../template/', import.meta.url)
const PACKAGE_JSON_TEMPLATE = new URL('package.json.template', TEMPLATE_DIR)
// Mirrors SKIP_DIRS in src/index.ts — directories create-mercato-app never copies.
const SCAFFOLD_SKIPPED_DIRS = new Set(['__tests__', '__integration__'])

function listScaffoldedTestFiles(dir: string): string[] {
  const found: string[] = []

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SCAFFOLD_SKIPPED_DIRS.has(entry.name)) continue
      found.push(...listScaffoldedTestFiles(path.join(dir, entry.name)))
    } else if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(entry.name)) {
      found.push(path.join(dir, entry.name))
    }
  }

  return found
}

function readScripts(): Record<string, string> {
  const raw = fs.readFileSync(PACKAGE_JSON_TEMPLATE, 'utf8')
  const parsed = JSON.parse(raw) as { scripts?: Record<string, string> }
  return parsed.scripts ?? {}
}

function readDevDependencies(): Record<string, string> {
  const raw = fs.readFileSync(PACKAGE_JSON_TEMPLATE, 'utf8')
  const parsed = JSON.parse(raw) as { devDependencies?: Record<string, string> }
  return parsed.devDependencies ?? {}
}

function listTemplateScriptFiles(dir: string): string[] {
  const found: string[] = []

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      found.push(...listTemplateScriptFiles(entryPath))
    } else if (/\.mjs$/.test(entry.name)) {
      found.push(entryPath)
    }
  }

  return found
}

// #4328: `yarn test`, `yarn lint`, and `yarn install-skills` failed on a clean
// scaffold because the template's package.json pointed at files it did not ship
// (and at `next lint`, removed in Next 16). Keep those targets honest.
test('every file a template script references is shipped by the template', () => {
  const scripts = readScripts()
  const referenced: Array<{ script: string; file: string }> = []

  for (const [name, command] of Object.entries(scripts)) {
    const configMatch = command.match(/--config\s+([^\s]+)/)
    if (configMatch && !configMatch[1].startsWith('.ai/')) {
      referenced.push({ script: name, file: configMatch[1] })
    }
    const shMatch = command.match(/\b(?:sh|bash|node)\s+(\.\/)?(scripts\/[^\s]+)/)
    if (shMatch) referenced.push({ script: name, file: shMatch[2] })
  }

  assert.ok(referenced.length > 0, 'expected the template to reference at least one script file')

  for (const { script, file } of referenced) {
    assert.ok(
      fs.existsSync(new URL(file, TEMPLATE_DIR)),
      `template script "${script}" references ${file}, which the template does not ship`,
    )
  }
})

test('every local ESM import in template scripts resolves inside the template', () => {
  const scriptFiles = listTemplateScriptFiles(fileURLToPath(new URL('scripts/', TEMPLATE_DIR)))
  const localImportPattern = /(?:from\s+|import\s*\()(['"])(\.\/[^'"]+)\1/g

  for (const scriptFile of scriptFiles) {
    const source = fs.readFileSync(scriptFile, 'utf8')
    for (const match of source.matchAll(localImportPattern)) {
      const importedPath = match[2]
      assert.ok(
        fs.existsSync(path.resolve(path.dirname(scriptFile), importedPath)),
        `template script ${path.relative(fileURLToPath(TEMPLATE_DIR), scriptFile)} imports missing ${importedPath}`,
      )
    }
  }
})

test('lint does not use `next lint` (removed in Next 16) and a flat config ships', () => {
  const scripts = readScripts()
  const eslintConfig = fs.readFileSync(new URL('eslint.config.mjs', TEMPLATE_DIR), 'utf8')
  assert.ok(scripts.lint, 'template must define a lint script')
  assert.ok(
    !/\bnext\s+lint\b/.test(scripts.lint),
    '`next lint` was removed in Next 16 — the template must call the ESLint CLI instead',
  )
  assert.ok(
    fs.existsSync(new URL('eslint.config.mjs', TEMPLATE_DIR)),
    'template must ship an eslint.config.mjs so `yarn lint` works out of the box',
  )
  assert.match(
    eslintConfig,
    /['"]\.ai\/framework-context\/\*\*['"]/,
    'materialized read-only framework source must stay outside the app lint scope',
  )
})

test('Jest ships the environment required by jsdom-annotated template tests', () => {
  const devDependencies = readDevDependencies()
  assert.ok(
    devDependencies['jest-environment-jsdom'],
    'template tests use @jest-environment jsdom, so standalone apps must install jest-environment-jsdom',
  )
})

test('Jest loads shared DOM matchers and transforms framework ESM dependencies', () => {
  const jestConfig = createRequire(import.meta.url)(
    fileURLToPath(new URL('jest.config.cjs', TEMPLATE_DIR)),
  ) as { setupFilesAfterEnv?: string[]; transformIgnorePatterns?: string[] }
  const setup = fs.readFileSync(new URL('jest.setup.ts', TEMPLATE_DIR), 'utf8')
  const ignoredPatterns = (jestConfig.transformIgnorePatterns ?? []).map(
    (pattern) => new RegExp(pattern),
  )

  assert.deepEqual(jestConfig.setupFilesAfterEnv, ['<rootDir>/jest.setup.ts'])
  assert.match(setup, /@testing-library\/jest-dom\/jest-globals/)
  assert.match(setup, /ResizeObserver/)
  assert.match(setup, /scrollIntoView/)

  for (const modulePath of [
    '/node_modules/@open-mercato/ui/dist/index.js',
    '/node_modules/@mikro-orm/decorators/legacy/index.js',
  ]) {
    assert.equal(
      ignoredPatterns.some((pattern) => pattern.test(modulePath)),
      false,
      `${modulePath} must be transformed by Jest`,
    )
  }
})

// MikroORM v7 is ESM-only and calls `import.meta.resolve()` at module scope.
// Jest loads it as CommonJS, so a bare ts-jest transform dies with
// "Cannot use 'import.meta' outside a module" before a single assertion runs —
// and `@open-mercato/shared/lib/commands` pulls MikroORM in transitively, which
// covers every command, entity, and data-engine test the harness tells an app
// author to write. The monorepo has always shipped a sanitizing transformer for
// this; the standalone template did not, which is what a live session hit.
test('Jest routes every transform through the sanitizing MikroORM transformer', () => {
  const transformerRelativePath = 'scripts/jest-mikroorm-transformer.cjs'
  const transformerUrl = new URL(transformerRelativePath, TEMPLATE_DIR)
  const jestConfig = createRequire(import.meta.url)(
    fileURLToPath(new URL('jest.config.cjs', TEMPLATE_DIR)),
  ) as { transform?: Record<string, unknown> }
  const transformEntries = Object.values(jestConfig.transform ?? {})

  assert.ok(transformEntries.length > 0, 'template jest config declares no transform')
  for (const entry of transformEntries) {
    assert.equal(
      Array.isArray(entry) ? entry[0] : entry,
      `<rootDir>/${transformerRelativePath}`,
      'a bare ts-jest transform cannot parse MikroORM',
    )
  }

  assert.ok(fs.existsSync(transformerUrl), `${transformerRelativePath} is missing from the template`)
  const transformer = createRequire(import.meta.url)(fileURLToPath(transformerUrl)) as {
    createTransformer: (config: unknown) => unknown
    sanitize: (code: string) => string
  }
  assert.equal(typeof transformer.createTransformer, 'function')

  const sanitized = transformer.sanitize(
    "const url = import.meta.resolve('pg'); const dir = import.meta.dirname; const self = import.meta.url; const bare = import.meta",
  )
  assert.ok(!sanitized.includes('import.meta'), 'a surviving import.meta still fails to parse')
  assert.ok(sanitized.includes("require.resolve('pg')"))

  const untouched = "const literal = 'import' + '.meta'\nexport const value = 1\n"
  assert.equal(transformer.sanitize(untouched), untouched, 'sanitization must be a no-op elsewhere')

  // The monorepo's copy redirects `typescript` to the `typescript-js` alias
  // because it pins the native TypeScript 7 compiler ts-jest cannot drive.
  // Standalone apps pin TypeScript 6 and never install that alias, so copying
  // the redirect would break every scaffolded app's test run at require time.
  assert.ok(
    !fs.readFileSync(transformerUrl, 'utf8').includes('typescript-js'),
    'standalone apps do not install typescript-js',
  )
})

test('the template ignores raw agent session exports', () => {
  const gitignore = fs.readFileSync(new URL('gitignore', TEMPLATE_DIR), 'utf8')

  assert.match(gitignore, /^\.ai\/sessions\*\.json$/m)
  assert.match(gitignore, /^\.ai\/session-exports\/$/m)
})

test('the template predeclares Next type outputs under the configured build directory', () => {
  const tsconfig = JSON.parse(
    fs.readFileSync(new URL('tsconfig.json', TEMPLATE_DIR), 'utf8'),
  ) as { include?: string[] }

  assert.ok(tsconfig.include?.includes('.mercato/next/types/**/*.ts'))
  assert.ok(tsconfig.include?.includes('.mercato/next/dev/types/**/*.ts'))
})

test('the standalone smoke test installs the scaffold before invoking its Yarn scripts', () => {
  const smokeTest = fs.readFileSync(
    new URL('../../../../scripts/test-create-app.ts', import.meta.url),
    'utf8',
  )
  const installIndex = smokeTest.indexOf("runCommand('yarn', ['install']")
  const scriptIndex = smokeTest.indexOf("runCommand('yarn', ['verify:yarn-script-resolution']")

  assert.ok(installIndex >= 0, 'the standalone smoke test must install scaffold dependencies')
  assert.ok(scriptIndex >= 0, 'the standalone smoke test must retain its Yarn script probe')
  assert.ok(
    installIndex < scriptIndex,
    'a fresh scaffold has only a bootstrap lockfile, so Yarn scripts must run after the first install',
  )
})

test('the standalone smoke installs from the same Verdaccio registry it publishes to', () => {
  const smokeTest = fs.readFileSync(
    new URL('../../../../scripts/test-create-app.ts', import.meta.url),
    'utf8',
  )

  assert.match(
    smokeTest,
    /\[CREATE_APP_BIN, appDir, '--registry', VERDACCIO_URL, '--agents', 'all'\]/,
    'the scaffold must not silently fall back to the fixed --verdaccio port',
  )
  assert.match(
    smokeTest,
    /yarnConfig\.includes\(`npmRegistryServer: \"\$\{VERDACCIO_URL\}\"`\)/,
    'the smoke must verify the generated Yarn registry before installing packages',
  )
})

test('the standalone integration lane uses the configured Verdaccio registry', () => {
  const integrationTest = fs.readFileSync(
    new URL('../../../../scripts/test-create-app-integration.ts', import.meta.url),
    'utf8',
  )

  assert.match(
    integrationTest,
    /\[CREATE_APP_BIN, appDir, '--registry', VERDACCIO_URL, '--skip-agentic-setup'\]/,
    'the activated standalone lane must not silently fall back to the fixed --verdaccio port',
  )
  assert.match(
    integrationTest,
    /yarnConfig\.includes\(`npmRegistryServer: \"\$\{VERDACCIO_URL\}\"`\)/,
    'the activated standalone lane must verify the generated Yarn registry before installing packages',
  )
})

test('`yarn test` succeeds on a scaffold that ships no test files', () => {
  const scaffoldedTestFiles = listScaffoldedTestFiles(fileURLToPath(new URL('src/', TEMPLATE_DIR)))
  const jestConfig = createRequire(import.meta.url)(
    fileURLToPath(new URL('jest.config.cjs', TEMPLATE_DIR)),
  ) as { passWithNoTests?: boolean }

  assert.equal(
    scaffoldedTestFiles.length,
    0,
    'template test files live in __tests__/__integration__, which create-mercato-app skips',
  )
  assert.equal(
    jestConfig.passWithNoTests,
    true,
    'the scaffold copies no test files, so `yarn test` needs passWithNoTests to avoid exiting 1 on a clean app',
  )
})

test('install-skills is a successful no-op before agentic setup', () => {
  const result = spawnSync('sh', ['scripts/install-skills.sh'], {
    cwd: fileURLToPath(TEMPLATE_DIR),
    encoding: 'utf8',
  })

  assert.equal(result.status, 0, result.stderr || result.stdout)
  assert.match(result.stdout, /mercato agentic:init/)
})

test('agentic operational placeholders fail closed with actionable setup guidance', () => {
  for (const script of [
    'evaluate-agent-harness.mjs',
    'framework-context.mjs',
    'prepare-agent-harness-fixture.mjs',
    'run-agent-harness-release.mjs',
  ]) {
    const result = spawnSync(process.execPath, [`scripts/${script}`], {
      cwd: fileURLToPath(TEMPLATE_DIR),
      encoding: 'utf8',
    })

    assert.equal(result.status, 2, `${script}: ${result.stderr || result.stdout}`)
    assert.match(result.stderr, /mercato agentic:init/, `${script} must explain how to install the agentic harness`)
  }
})
