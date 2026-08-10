import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const preparer = fileURLToPath(
  new URL('../../../../.ai/skills/om-share-this-session/scripts/prepare-share-bundle.mjs', import.meta.url),
)
const codexExporter = fileURLToPath(
  new URL('../../../../.ai/skills/om-share-this-session/scripts/export-codex-session.mjs', import.meta.url),
)
const monorepoSkillDirectory = fileURLToPath(
  new URL('../../../../.ai/skills/om-share-this-session/', import.meta.url),
)
const standaloneSkillDirectory = fileURLToPath(
  new URL('../../agentic/shared/ai/skills/om-share-this-session/', import.meta.url),
)

function relativeFiles(root: string, current = root): string[] {
  return fs.readdirSync(current, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(current, entry.name)
    if (entry.isDirectory()) return relativeFiles(root, absolutePath)
    return [path.relative(root, absolutePath).split(path.sep).join('/')]
  }).sort()
}

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

function createFakeCodex(root: string): string {
  const binDirectory = path.join(root, 'bin')
  const executablePath = path.join(binDirectory, 'codex')
  fs.mkdirSync(binDirectory)
  fs.writeFileSync(
    executablePath,
    `#!/usr/bin/env node
let input = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  input += chunk
  while (input.includes('\\n')) {
    const newlineIndex = input.indexOf('\\n')
    const line = input.slice(0, newlineIndex)
    input = input.slice(newlineIndex + 1)
    if (!line.trim()) continue
    const message = JSON.parse(line)
    if (message.id === 1) {
      process.stdout.write(JSON.stringify({ id: 1, result: { userAgent: 'fake-codex' } }) + '\\n')
    }
    if (message.id === 2) {
      const requestedId = message.params.threadId
      const threadId = process.env.FAKE_CODEX_MODE === 'mismatch'
        ? 'ffffffff-ffff-ffff-ffff-ffffffffffff'
        : requestedId
      process.stdout.write(JSON.stringify({
        id: 2,
        result: {
          thread: {
            id: threadId,
            sessionId: threadId,
            turns: [
              {
                id: 'turn-1',
                items: [
                  { type: 'userMessage', content: [{ type: 'text', text: 'Hello' }] },
                  { type: 'agentMessage', text: 'Working' },
                  { type: 'agentMessage', text: 'Done' },
                ],
              },
            ],
          },
        },
      }) + '\\n')
    }
  }
})
`,
  )
  fs.chmodSync(executablePath, 0o755)
  return binDirectory
}

function runCodexExporter(root: string, mode = 'success') {
  const threadId = '123e4567-e89b-42d3-a456-426614174000'
  const outputPath = path.join(root, 'native-codex-session.json')
  const binDirectory = createFakeCodex(root)
  const result = spawnSync(
    process.execPath,
    [codexExporter, '--thread-id', threadId, '--out', outputPath],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${binDirectory}${path.delimiter}${process.env.PATH ?? ''}`,
        FAKE_CODEX_MODE: mode,
      },
    },
  )
  return { result, outputPath, threadId }
}

test('Codex session exporter reads the requested native thread through app-server', () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-codex-export-')))
  try {
    const { result, outputPath, threadId } = runCodexExporter(root)
    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(JSON.parse(result.stdout), { status: 'exported', turns: 1 })
    const exported = JSON.parse(fs.readFileSync(outputPath, 'utf8')) as {
      id: string
      sessionId: string
      turns: Array<{ items: Array<{ type: string }> }>
    }
    assert.equal(exported.id, threadId)
    assert.equal(exported.sessionId, threadId)
    assert.deepEqual(exported.turns.flatMap((turn) => turn.items.map((item) => item.type)), [
      'userMessage',
      'agentMessage',
      'agentMessage',
    ])
    assert.equal(fs.statSync(outputPath).mode & 0o077, 0, 'native export must be owner-readable only')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('Codex session exporter rejects a mismatched thread without leaving output', () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-codex-export-')))
  try {
    const { result, outputPath } = runCodexExporter(root, 'mismatch')
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /different thread than requested/)
    assert.equal(fs.existsSync(outputPath), false)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('session-share preparer preserves turns, sanitizes content, and creates a valid generated-files ZIP', () => {
  const fixture = createFixture()
  try {
    const fakeToken = 'github_pat_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
    const fakeHexSecret = 'a1'.repeat(32)
    const fakeIdentifier = '123e4567-e89b-42d3-a456-426614174000'
    const session = [
      {
        type: 'user',
        sessionId: 'session-private-123',
        cwd: '/Users/alice/Customer Alpha',
        metadata: JSON.parse(
          '{"alice@example.com":"Customer Alpha","__proto__":{"safe":"value"}}',
        ) as Record<string, unknown>,
        message: {
          role: 'user',
          content: `Please contact alice@example.com and use token=${fakeToken}, id=${fakeIdentifier}, checksum=${fakeHexSecret}`,
        },
      },
      {
        type: 'assistant',
        sessionId: 'session-private-123',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Generated from 192.168.10.12 for Customer Alpha.' }],
        },
      },
    ]
    fs.writeFileSync(fixture.sessionPath, `${JSON.stringify(session)}\n`)
    fs.writeFileSync(
      path.join(fixture.root, 'src', 'generated.ts'),
      `export const owner = 'alice@example.com'\nexport const token = '${fakeToken}'\nexport const customer = 'Customer Alpha'\nexport const id = '${fakeIdentifier}'\nexport const opaqueSecret = '${fakeHexSecret}'\n`,
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
    assert.doesNotMatch(sanitizedSession, /alice@example\.com|github_pat_|Customer Alpha|\/Users\/alice|192\.168\.10\.12|123e4567|a1a1a1a1/)
    assert.match(sanitizedSession, /redacted:email/)
    assert.match(sanitizedSession, /redacted:credential/)
    assert.match(sanitizedSession, /redacted:custom-literal/)
    assert.match(sanitizedSession, /redacted:identifier/)
    assert.match(sanitizedSession, /redacted:hex-secret/)
    const identifierMarkers = sanitizedSession.match(/redacted:identifier:[a-f0-9]{12}/g) ?? []
    assert.equal(identifierMarkers.length, 2)
    assert.equal(identifierMarkers[0], identifierMarkers[1], 'equal identifiers must keep bundle-local correlation')
    assert.notEqual(
      identifierMarkers[0],
      `redacted:identifier:${createHash('sha256').update('session-private-123').digest('hex').slice(0, 12)}`,
      'identifier pseudonyms must not expose an unsalted dictionary hash',
    )
    const sanitizedSessionJson = JSON.parse(sanitizedSession) as Array<{ metadata: Record<string, unknown> }>
    assert.equal(Object.hasOwn(sanitizedSessionJson[0].metadata, '__proto__'), true, 'JSON __proto__ keys must remain own data properties')
    assert.equal(Object.keys(sanitizedSessionJson[0].metadata).some((key) => key.includes('redacted:email')), true)

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

test('session-share preparer recognizes messages nested in native Codex turns', () => {
  const fixture = createFixture()
  try {
    fs.writeFileSync(
      fixture.sessionPath,
      JSON.stringify({
        id: '123e4567-e89b-42d3-a456-426614174000',
        sessionId: '123e4567-e89b-42d3-a456-426614174000',
        turns: [
          {
            id: 'turn-1',
            items: [
              { type: 'userMessage', content: [{ type: 'text', text: 'Hello' }] },
              { type: 'reasoning', summary: [] },
              { type: 'agentMessage', text: 'Working' },
              { type: 'agentMessage', text: 'Done' },
            ],
          },
        ],
      }),
    )
    fs.writeFileSync(path.join(fixture.root, 'src', 'generated.ts'), 'export {}\n')
    fs.writeFileSync(fixture.manifestPath, 'src/generated.ts\n')

    const result = runPreparer(fixture)
    assert.equal(result.status, 0, result.stderr)
    const manifest = JSON.parse(fs.readFileSync(path.join(fixture.outputPath, 'manifest.json'), 'utf8')) as {
      session: {
        collection: string
        entries: number
        recognizedTurns: number
        userTurns: number
        assistantTurns: number
        firstRecognizedRole: string
        lastRecognizedRole: string
      }
    }
    assert.equal(manifest.session.collection, 'turns')
    assert.equal(manifest.session.entries, 1)
    assert.equal(manifest.session.recognizedTurns, 2)
    assert.equal(manifest.session.userTurns, 1)
    assert.equal(manifest.session.assistantTurns, 1)
    assert.equal(manifest.session.firstRecognizedRole, 'user')
    assert.equal(manifest.session.lastRecognizedRole, 'assistant')
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

  await t.test('normalized duplicate path', () => {
    const fixture = createFixture()
    try {
      fs.writeFileSync(fixture.sessionPath, JSON.stringify([{ type: 'user' }, { type: 'assistant' }]))
      fs.writeFileSync(path.join(fixture.root, 'src', 'generated.ts'), 'export {}\n')
      fs.writeFileSync(fixture.manifestPath, 'src/generated.ts\n./src/generated.ts\n')
      const result = runPreparer(fixture)
      assert.notEqual(result.status, 0)
      assert.match(result.stderr, /same normalized path/)
      assert.equal(fs.existsSync(fixture.outputPath), false)
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true })
    }
  })
})

test('monorepo and standalone session-share skills stay byte-identical and default-installed', () => {
  const monorepoFiles = relativeFiles(monorepoSkillDirectory)
  const standaloneFiles = relativeFiles(standaloneSkillDirectory)
  assert.deepEqual(standaloneFiles, monorepoFiles)
  for (const relativePath of monorepoFiles) {
    assert.deepEqual(
      fs.readFileSync(path.join(standaloneSkillDirectory, relativePath)),
      fs.readFileSync(path.join(monorepoSkillDirectory, relativePath)),
      `${relativePath} must not drift between the monorepo and create-app bundle`,
    )
  }

  for (const manifestPath of [
    new URL('../../../../.ai/skills/tiers.json', import.meta.url),
    new URL('../../agentic/shared/ai/skills/tiers.json', import.meta.url),
  ]) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
      default?: string[]
      tiers?: Record<string, { skills?: string[] }>
    }
    const defaultSkills = new Set((manifest.default ?? []).flatMap((tier) => manifest.tiers?.[tier]?.skills ?? []))
    assert.equal(defaultSkills.has('om-share-this-session'), true, `${manifestPath.pathname} must install the skill by default`)
  }

  const skill = fs.readFileSync(path.join(monorepoSkillDirectory, 'SKILL.md'), 'utf8')
  const consent = fs.readFileSync(path.join(monorepoSkillDirectory, 'references', 'consent-and-review.md'), 'utf8')
  assert.match(skill, /Invocation, earlier consent, or a generic “yes” never satisfies this gate/)
  assert.match(consent, /I AGREE TO PUBLICLY SHARE "<share-name>" WITH OPEN-MERCATO/)
  assert.match(consent, /Deleting the temporary branch later cannot guarantee erasure/)
})

test('both standalone copy pipelines include the whole skill tree and tracker publication stays atomic', () => {
  const createAppSource = fs.readFileSync(new URL('../setup/tools/shared.ts', import.meta.url), 'utf8')
  const cliSource = fs.readFileSync(new URL('../../../cli/src/lib/agentic-setup.ts', import.meta.url), 'utf8')
  assert.match(createAppSource, /copyTree\(join\(AGENTIC_DIR, 'ai'\), join\(targetDir, '\.ai'\), config\)/)
  assert.match(cliSource, /copyTree\(join\(srcDir, 'ai'\), join\(targetDir, '\.ai'\), config\)/)

  const monorepoTracker = fs.readFileSync(new URL('../../../../.ai/trackers/github.md', import.meta.url), 'utf8')
  const standaloneTracker = fs.readFileSync(new URL('../../agentic/shared/ai/trackers/github.md', import.meta.url), 'utf8')
  assert.equal(standaloneTracker, monorepoTracker, 'standalone tracker descriptor must mirror the monorepo provider')
  const extractSessionOperations = (source: string) => {
    const start = source.indexOf('### Public session-share artifacts')
    const end = source.indexOf('\n### Issues', start)
    assert.ok(start >= 0 && end > start, 'tracker must define the session-share operation block')
    return source.slice(start, end)
  }
  const publication = extractSessionOperations(monorepoTracker)
  assert.equal(extractSessionOperations(standaloneTracker), publication)
  assert.ok(
    publication.indexOf('git/blobs') < publication.indexOf('git/refs" --input -'),
    'the provider must create private blobs/commit before exposing the branch ref',
  )
  assert.ok(
    publication.indexOf('[ "$ARTIFACT_BYTES" -le 26214400 ]') < publication.indexOf('git/blobs'),
    'the provider must validate the complete local bundle before the first remote blob write',
  )
  assert.equal(publication.match(/for ARTIFACT in session\.json generated-files\.zip manifest\.json privacy-report\.json/g)?.length, 2)
  assert.match(publication, /#### delete-session-share/)
  assert.match(publication, /\[ "\$SHARE_BRANCH" = "session-share-\$SHARE_NAME" \] \|\| exit 1/)
  assert.match(monorepoTracker, /--state "\$ISSUE_STATE"/, 'issue deduplication must support open and closed shares')
})
