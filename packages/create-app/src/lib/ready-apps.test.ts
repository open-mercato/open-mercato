import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import * as tar from 'tar'
import {
  downloadReadyAppSnapshot,
  extractTarballSnapshot,
  getGitHubApiBaseUrl,
  parseGitHubRepositoryUrl,
  resolveOfficialReadyAppSource,
  resolveReadyAppSource,
  validateImportedReadyAppSnapshot,
} from './ready-apps.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = resolve(__dirname, '..', '..')
const CLI_BIN = join(PACKAGE_ROOT, 'bin', 'create-mercato-app')
const CLI_ENTRY = join(PACKAGE_ROOT, 'src', 'index.ts')
const PACKAGE_VERSION = (
  JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')) as { version: string }
).version

function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

async function createGitHubStyleTarball(files: Record<string, string>): Promise<Uint8Array> {
  const tempDir = makeTempDir('create-mercato-app-fixture-')
  const rootDir = join(tempDir, 'fixture-root')
  const archivePath = join(tempDir, 'fixture.tar.gz')

  mkdirSync(rootDir, { recursive: true })

  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = join(rootDir, relativePath)
    mkdirSync(dirname(absolutePath), { recursive: true })
    writeFileSync(absolutePath, content)
  }

  await tar.c(
    {
      cwd: tempDir,
      gzip: true,
      file: archivePath,
    },
    ['fixture-root'],
  )

  const archive = new Uint8Array(readFileSync(archivePath))
  rmSync(tempDir, { recursive: true, force: true })
  return archive
}

test('resolveOfficialReadyAppSource maps app slug to repo and exact tag', () => {
  const source = resolveOfficialReadyAppSource('prm', PACKAGE_VERSION)

  assert.deepEqual(source, {
    kind: 'official',
    appSlug: 'prm',
    owner: 'open-mercato',
    repo: 'ready-app-prm',
    ref: `v${PACKAGE_VERSION}`,
  })
})

test('resolveReadyAppSource rejects multiple source flags', () => {
  assert.throws(
    () =>
      resolveReadyAppSource(
        {
          app: 'prm',
          appUrl: 'https://github.com/some-agency/ready-app-marketplace',
        },
        '0.4.9',
      ),
    /mutually exclusive/i,
  )
})

test('parseGitHubRepositoryUrl extracts owner, repo, and refs with slashes', () => {
  const parsed = parseGitHubRepositoryUrl(
    'https://github.com/some-agency/ready-app-marketplace/tree/releases/2026-04',
  )

  assert.deepEqual(parsed, {
    owner: 'some-agency',
    repo: 'ready-app-marketplace',
    ref: 'releases/2026-04',
    normalizedUrl: 'https://github.com/some-agency/ready-app-marketplace/tree/releases/2026-04',
  })
})

test('extractTarballSnapshot strips the GitHub root folder', async () => {
  const archive = await createGitHubStyleTarball({
    'package.json': '{"name":"ready-app-prm"}\n',
    'src/modules.ts': 'export default []\n',
  })
  const targetDir = makeTempDir('create-mercato-app-extract-')

  try {
    await extractTarballSnapshot(archive, targetDir)

    assert.equal(existsSync(join(targetDir, 'package.json')), true)
    assert.equal(existsSync(join(targetDir, 'src', 'modules.ts')), true)
  } finally {
    rmSync(targetDir, { recursive: true, force: true })
  }
})

test('validateImportedReadyAppSnapshot fails closed on template files', () => {
  const targetDir = makeTempDir('create-mercato-app-template-check-')

  try {
    mkdirSync(join(targetDir, 'src'), { recursive: true })
    writeFileSync(join(targetDir, 'src', 'package.json.template'), '{}\n')

    assert.throws(
      () => validateImportedReadyAppSnapshot(targetDir),
      /must be committed source snapshots/i,
    )
  } finally {
    rmSync(targetDir, { recursive: true, force: true })
  }
})

test('downloadReadyAppSnapshot resolves external default branches through the GitHub API', async () => {
  const githubApiBaseUrl = getGitHubApiBaseUrl()
  const calls: string[] = []
  const fetchMock = (async (input: RequestInfo | URL) => {
    const url = String(input)
    calls.push(url)

    if (url === `${githubApiBaseUrl}/repos/some-agency/ready-app-marketplace`) {
      return new Response(JSON.stringify({ default_branch: 'main' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }

    if (url === `${githubApiBaseUrl}/repos/some-agency/ready-app-marketplace/tarball/main`) {
      return new Response(Uint8Array.from([1, 2, 3]), {
        status: 200,
        headers: { 'content-type': 'application/octet-stream' },
      })
    }

    return new Response(JSON.stringify({ message: 'Not Found' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch

  const source = resolveReadyAppSource(
    { appUrl: 'https://github.com/some-agency/ready-app-marketplace' },
    '0.4.9',
  )

  assert.ok(source)
  const download = await downloadReadyAppSnapshot(source, '0.4.9', fetchMock)

  assert.equal(download.ref, 'main')
  assert.deepEqual(Array.from(download.archive), [1, 2, 3])
  assert.deepEqual(calls, [
    `${githubApiBaseUrl}/repos/some-agency/ready-app-marketplace`,
    `${githubApiBaseUrl}/repos/some-agency/ready-app-marketplace/tarball/main`,
  ])
})

test('published CLI bin executes the dist entrypoint', () => {
  const buildResult = spawnSync(process.execPath, ['build.mjs'], {
    cwd: PACKAGE_ROOT,
    encoding: 'utf8',
    env: process.env,
  })

  assert.equal(
    buildResult.status,
    0,
    `expected package build to succeed\nstdout:\n${buildResult.stdout}\nstderr:\n${buildResult.stderr}`,
  )

  const result = spawnSync(process.execPath, [CLI_BIN, '--help'], {
    cwd: PACKAGE_ROOT,
    encoding: 'utf8',
    env: process.env,
  })

  assert.equal(
    result.status,
    0,
    `expected bin wrapper to succeed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  )
  assert.match(result.stdout, /--app-url/)
  assert.match(result.stdout, /--skip-agentic-setup/)
})

test('CLI bare scaffold skips interactive agentic setup with --skip-agentic-setup', () => {
  const targetRoot = makeTempDir('create-mercato-app-cli-ci-')
  const targetDir = join(targetRoot, 'ci-app')

  try {
    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx', CLI_ENTRY, targetDir, '--skip-agentic-setup'],
      {
        cwd: PACKAGE_ROOT,
        encoding: 'utf8',
        env: process.env,
        timeout: 5000,
      },
    )

    assert.equal(
      result.status,
      0,
      `expected CLI scaffold with --skip-agentic-setup to succeed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}\nerror:\n${result.error instanceof Error ? result.error.message : 'none'}`,
    )
    assert.match(result.stdout, /Skipped agentic setup/)
    assert.equal(existsSync(join(targetDir, 'package.json')), true)
    assert.equal(existsSync(join(targetDir, '.claude')), false)
    assert.equal(existsSync(join(targetDir, '.cursor')), false)
    assert.equal(existsSync(join(targetDir, '.codex')), false)
  } finally {
    rmSync(targetRoot, { recursive: true, force: true })
  }
})

test('CLI imported ready apps skip wizard-generated files', async () => {
  const archive = await createGitHubStyleTarball({
    'package.json': '{"name":"ready-app-prm","version":"0.0.1"}\n',
    'README.md': '# Ready App PRM\n',
    'src/modules.ts': 'export default []\n',
  })

  const targetRoot = makeTempDir('create-mercato-app-cli-import-')
  const targetDir = join(targetRoot, 'ready-prm')
  const mockFetchModulePath = join(targetRoot, 'mock-fetch.mjs')
  const archiveBase64 = Buffer.from(archive).toString('base64')

  writeFileSync(
    mockFetchModulePath,
    `const archive = Uint8Array.from(Buffer.from('${archiveBase64}', 'base64'))
globalThis.fetch = async (input) => {
  const url = String(input)
  if (url.endsWith('/repos/open-mercato/ready-app-prm')) {
    return new Response(JSON.stringify({ default_branch: 'main' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }
  if (url.endsWith('/repos/open-mercato/ready-app-prm/tarball/v${PACKAGE_VERSION}')) {
    return new Response(archive, {
      status: 200,
      headers: { 'content-type': 'application/octet-stream' },
    })
  }
  return new Response(JSON.stringify({ message: 'Not Found' }), {
    status: 404,
    headers: { 'content-type': 'application/json' },
  })
}
`,
  )

  try {
    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx', '--import', pathToFileURL(mockFetchModulePath).href, CLI_ENTRY, targetDir, '--app', 'prm'],
      {
        cwd: PACKAGE_ROOT,
        encoding: 'utf8',
        env: process.env,
      },
    )

    assert.equal(
      result.status,
      0,
      `expected CLI import to succeed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    )
    assert.equal(existsSync(join(targetDir, 'package.json')), true)
    assert.equal(existsSync(join(targetDir, 'AGENTS.md')), false)
    assert.equal(existsSync(join(targetDir, '.ai')), false)
    assert.equal(existsSync(join(targetDir, '.claude')), false)
    assert.equal(existsSync(join(targetDir, '.cursor')), false)
    assert.equal(existsSync(join(targetDir, '.mercato', 'generated', 'module-package-sources.css')), true)
  } finally {
    rmSync(targetRoot, { recursive: true, force: true })
  }
})
