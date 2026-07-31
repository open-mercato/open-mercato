import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const preparer = fileURLToPath(
  new URL('../../../../.ai/skills/om-share-this-session/scripts/prepare-share-bundle.mjs', import.meta.url),
)

function createFixture(): {
  root: string
  sessionPath: string
  manifestPath: string
  outputPath: string
} {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-session-share-')))
  const sessionPath = path.join(root, 'native-session.json')
  const manifestPath = path.join(root, 'generated-files.txt')
  const outputPath = path.join(root, 'prepared', 'bundle')
  fs.mkdirSync(path.join(root, 'src'), { recursive: true })
  return { root, sessionPath, manifestPath, outputPath }
}

function runPreparer(fixture: ReturnType<typeof createFixture>, extraArguments: string[] = []) {
  return spawnSync(
    process.execPath,
    [
      preparer,
      '--name',
      'harness-layout-run',
      '--session',
      fixture.sessionPath,
      '--project-root',
      fixture.root,
      '--files',
      fixture.manifestPath,
      '--out',
      fixture.outputPath,
      ...extraArguments,
    ],
    { encoding: 'utf8' },
  )
}

test('session-share preparer preserves turns, sanitizes content, and creates a valid generated-files ZIP', () => {
  const fixture = createFixture()
  try {
    const fakeToken = 'github_pat_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
    const session = [
      {
        type: 'user',
        sessionId: 'session-private-123',
        cwd: '/Users/alice/Customer Alpha',
        message: {
          role: 'user',
          content: `Please contact alice@example.com and use token=${fakeToken}`,
        },
      },
      {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Generated from 192.168.10.12 for Customer Alpha.' }],
        },
      },
    ]
    fs.writeFileSync(fixture.sessionPath, `${JSON.stringify(session)}\n`)
    fs.writeFileSync(
      path.join(fixture.root, 'src', 'generated.ts'),
      `export const owner = 'alice@example.com'\nexport const token = '${fakeToken}'\nexport const customer = 'Customer Alpha'\n`,
    )
    fs.writeFileSync(fixture.manifestPath, 'src/generated.ts\n')
    const redactionListPath = path.join(fixture.root, 'redact-literals.txt')
    fs.writeFileSync(redactionListPath, 'Customer Alpha\n')

    const originalSession = fs.readFileSync(fixture.sessionPath, 'utf8')
    const originalGeneratedFile = fs.readFileSync(path.join(fixture.root, 'src', 'generated.ts'), 'utf8')
    const result = runPreparer(fixture, ['--redact-list', redactionListPath])
    assert.equal(result.status, 0, result.stderr)

    assert.equal(fs.readFileSync(fixture.sessionPath, 'utf8'), originalSession, 'source session must stay untouched')
    assert.equal(
      fs.readFileSync(path.join(fixture.root, 'src', 'generated.ts'), 'utf8'),
      originalGeneratedFile,
      'source generated files must stay untouched',
    )

    const sanitizedSession = fs.readFileSync(path.join(fixture.outputPath, 'session.json'), 'utf8')
    assert.doesNotMatch(sanitizedSession, /alice@example\.com|github_pat_|Customer Alpha|\/Users\/alice|192\.168\.10\.12/)
    assert.match(sanitizedSession, /redacted:email/)
    assert.match(sanitizedSession, /redacted:credential/)
    assert.match(sanitizedSession, /redacted:custom-literal/)
    assert.match(sanitizedSession, /redacted:identifier/)

    const manifest = JSON.parse(fs.readFileSync(path.join(fixture.outputPath, 'manifest.json'), 'utf8')) as {
      session: { entries: number; userTurns: number; assistantTurns: number }
      generatedFiles: Array<{ path: string }>
      artifacts: Record<string, { bytes: number; sha256: string }>
    }
    assert.equal(manifest.session.entries, 2)
    assert.equal(manifest.session.userTurns, 1)
    assert.equal(manifest.session.assistantTurns, 1)
    assert.deepEqual(manifest.generatedFiles.map((file) => file.path), ['src/generated.ts'])
    assert.ok(manifest.artifacts['generated-files.zip'].bytes > 0)
    assert.match(manifest.artifacts['generated-files.zip'].sha256, /^[a-f0-9]{64}$/)

    const privacyReport = JSON.parse(fs.readFileSync(path.join(fixture.outputPath, 'privacy-report.json'), 'utf8')) as {
      automatedScan: string
      semanticReview: string
      redactions: Record<string, number>
    }
    assert.equal(privacyReport.automatedScan, 'pass')
    assert.equal(privacyReport.semanticReview, 'required')
    assert.ok(privacyReport.redactions.secrets >= 2)
    assert.ok(privacyReport.redactions.pii >= 2)
    assert.ok(privacyReport.redactions.custom >= 2)

    const unzipResult = spawnSync(
      'unzip',
      ['-p', path.join(fixture.outputPath, 'generated-files.zip'), 'src/generated.ts'],
      { encoding: 'utf8' },
    )
    assert.equal(unzipResult.status, 0, unzipResult.stderr)
    assert.doesNotMatch(unzipResult.stdout, /alice@example\.com|github_pat_|Customer Alpha/)
    assert.equal(
      unzipResult.stdout,
      fs.readFileSync(path.join(fixture.outputPath, 'review', 'generated-files', 'src', 'generated.ts'), 'utf8'),
      'local review tree must match the archived sanitized file',
    )
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true })
  }
})

test('session-share preparer fails closed for incomplete sessions and unsafe file inputs', async (t) => {
  await t.test('missing assistant turn', () => {
    const fixture = createFixture()
    try {
      fs.writeFileSync(fixture.sessionPath, JSON.stringify([{ type: 'user', content: 'hello' }]))
      fs.writeFileSync(path.join(fixture.root, 'src', 'generated.ts'), 'export {}\n')
      fs.writeFileSync(fixture.manifestPath, 'src/generated.ts\n')
      const result = runPreparer(fixture)
      assert.notEqual(result.status, 0)
      assert.match(result.stderr, /at least one recognizable user turn and one assistant turn/)
      assert.equal(fs.existsSync(fixture.outputPath), false)
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true })
    }
  })

  await t.test('dangerous path', () => {
    const fixture = createFixture()
    try {
      fs.writeFileSync(fixture.sessionPath, JSON.stringify([{ type: 'user' }, { type: 'assistant' }]))
      fs.writeFileSync(path.join(fixture.root, '.env'), 'TOKEN=do-not-read\n')
      fs.writeFileSync(fixture.manifestPath, '.env\n')
      const result = runPreparer(fixture)
      assert.notEqual(result.status, 0)
      assert.match(result.stderr, /Dangerous generated-file path rejected/)
      assert.doesNotMatch(result.stderr, /do-not-read/)
      assert.equal(fs.existsSync(fixture.outputPath), false)
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true })
    }
  })

  await t.test('binary file', () => {
    const fixture = createFixture()
    try {
      fs.writeFileSync(fixture.sessionPath, JSON.stringify([{ type: 'user' }, { type: 'assistant' }]))
      fs.writeFileSync(path.join(fixture.root, 'src', 'generated.bin'), Buffer.from([0, 1, 2, 3]))
      fs.writeFileSync(fixture.manifestPath, 'src/generated.bin\n')
      const result = runPreparer(fixture)
      assert.notEqual(result.status, 0)
      assert.match(result.stderr, /contains binary data/)
      assert.equal(fs.existsSync(fixture.outputPath), false)
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true })
    }
  })

  await t.test('symlink', () => {
    const fixture = createFixture()
    try {
      fs.writeFileSync(fixture.sessionPath, JSON.stringify([{ type: 'user' }, { type: 'assistant' }]))
      fs.writeFileSync(path.join(fixture.root, 'outside.ts'), 'export {}\n')
      fs.symlinkSync(path.join(fixture.root, 'outside.ts'), path.join(fixture.root, 'src', 'linked.ts'))
      fs.writeFileSync(fixture.manifestPath, 'src/linked.ts\n')
      const result = runPreparer(fixture)
      assert.notEqual(result.status, 0)
      assert.match(result.stderr, /must not be a symlink|must be a regular file/)
      assert.equal(fs.existsSync(fixture.outputPath), false)
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true })
    }
  })
})
