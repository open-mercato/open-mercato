import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  parseDatabaseNameArgs,
  deriveDatabaseNameFromCwd,
  validateDatabaseName,
  resolveDatabaseName,
  rewriteDatabaseUrl,
  updateDatabaseUrlInEnvText,
  readEnvDatabaseUrl,
  isNonInteractiveEnvironment,
  parseUpdateEnvAnswer,
  resolveUpdateEnvDecisionFromEnv,
  readDatabaseNameEnvOverride,
  resolveDatabaseNameOverride,
  collectForwardedSetupFlags,
} from '../dev-database-url.mjs'

test('parseDatabaseNameArgs: omitted flag preserves argv and reports not-provided', () => {
  const result = parseDatabaseNameArgs(['--greenfield', '--verbose'])
  assert.equal(result.provided, false)
  assert.equal(result.rawValue, null)
  assert.equal(result.updateEnv, null)
  assert.deepEqual(result.remainingArgv, ['--greenfield', '--verbose'])
})

test('parseDatabaseNameArgs: --database-name=value parses explicit value', () => {
  const result = parseDatabaseNameArgs(['--database-name=client_a', '--verbose'])
  assert.equal(result.provided, true)
  assert.equal(result.rawValue, 'client_a')
  assert.deepEqual(result.remainingArgv, ['--verbose'])
})

test('parseDatabaseNameArgs: --database-name with following positional value', () => {
  const result = parseDatabaseNameArgs(['--database-name', 'client_b', '--setup'])
  assert.equal(result.provided, true)
  assert.equal(result.rawValue, 'client_b')
  assert.deepEqual(result.remainingArgv, ['--setup'])
})

test('parseDatabaseNameArgs: bare --database-name (no value) signals CWD derivation', () => {
  const result = parseDatabaseNameArgs(['--database-name'])
  assert.equal(result.provided, true)
  assert.equal(result.rawValue, null)
  assert.deepEqual(result.remainingArgv, [])
})

test('parseDatabaseNameArgs: --database-name= (empty value) also signals CWD derivation', () => {
  const result = parseDatabaseNameArgs(['--database-name='])
  assert.equal(result.provided, true)
  assert.equal(result.rawValue, '')
})

test('parseDatabaseNameArgs: --database-name does not consume next flag as value', () => {
  const result = parseDatabaseNameArgs(['--database-name', '--no-update-env'])
  assert.equal(result.provided, true)
  assert.equal(result.rawValue, null)
  assert.equal(result.updateEnv, false)
})

test('parseDatabaseNameArgs: --no-update-env / --update-env tracked', () => {
  assert.equal(parseDatabaseNameArgs(['--no-update-env']).updateEnv, false)
  assert.equal(parseDatabaseNameArgs(['--update-env']).updateEnv, true)
  assert.equal(parseDatabaseNameArgs([]).updateEnv, null)
})

test('deriveDatabaseNameFromCwd: lowercases and replaces non-alphanumerics', () => {
  assert.equal(deriveDatabaseNameFromCwd('/a/b/open-mercato'), 'open_mercato')
  assert.equal(deriveDatabaseNameFromCwd('/projects/Client-A'), 'client_a')
  assert.equal(deriveDatabaseNameFromCwd('Client.B App'), 'client_b_app')
})

test('deriveDatabaseNameFromCwd: trims leading/trailing underscores', () => {
  assert.equal(deriveDatabaseNameFromCwd('_my-app_'), 'my_app')
  assert.equal(deriveDatabaseNameFromCwd('--scratch--'), 'scratch')
})

test('deriveDatabaseNameFromCwd: prefixes om_ when starting with a digit', () => {
  assert.equal(deriveDatabaseNameFromCwd('/x/2026-redesign'), 'om_2026_redesign')
  assert.equal(deriveDatabaseNameFromCwd('1stApp'), 'om_1stapp')
})

test('deriveDatabaseNameFromCwd: falls back to open_mercato_dev for empty/non-alphanumeric', () => {
  assert.equal(deriveDatabaseNameFromCwd('////'), 'open_mercato_dev')
  assert.equal(deriveDatabaseNameFromCwd('___'), 'open_mercato_dev')
  assert.equal(deriveDatabaseNameFromCwd(''), 'open_mercato_dev')
})

test('validateDatabaseName: accepts allowed names', () => {
  assert.equal(validateDatabaseName('open_mercato').ok, true)
  assert.equal(validateDatabaseName('client-a').ok, true)
  assert.equal(validateDatabaseName('_underscore_first').ok, true)
  assert.equal(validateDatabaseName('A1_-_2').ok, true)
})

test('validateDatabaseName: rejects empty, leading-digit, or invalid chars', () => {
  assert.equal(validateDatabaseName('').ok, false)
  assert.equal(validateDatabaseName('1bad').ok, false)
  assert.equal(validateDatabaseName('with space').ok, false)
  assert.equal(validateDatabaseName('with;semi').ok, false)
  assert.equal(validateDatabaseName('"quoted"').ok, false)
})

test('validateDatabaseName: rejects names longer than PostgreSQL identifier limit', () => {
  assert.equal(validateDatabaseName('a'.repeat(63)).ok, true)
  assert.equal(validateDatabaseName('a'.repeat(64)).ok, false)
})

test('resolveDatabaseName: explicit value wins, CWD fallback when empty', () => {
  assert.deepEqual(
    resolveDatabaseName({ rawValue: 'client_a', cwd: '/x/y' }),
    { name: 'client_a', source: 'explicit' },
  )
  assert.deepEqual(
    resolveDatabaseName({ rawValue: '', cwd: '/x/y/open-mercato' }),
    { name: 'open_mercato', source: 'cwd' },
  )
  assert.deepEqual(
    resolveDatabaseName({ rawValue: null, cwd: '/x/y/client-b' }),
    { name: 'client_b', source: 'cwd' },
  )
  assert.deepEqual(
    resolveDatabaseName({ rawValue: '   ', cwd: '/x/y/client-c' }),
    { name: 'client_c', source: 'cwd' },
  )
})

test('rewriteDatabaseUrl: replaces only pathname database segment', () => {
  const url = 'postgres://postgres:postgres@localhost:5432/open-mercato'
  assert.equal(rewriteDatabaseUrl(url, 'client_a'), 'postgres://postgres:postgres@localhost:5432/client_a')
})

test('rewriteDatabaseUrl: preserves credentials with reserved characters', () => {
  const url = 'postgres://user:p%40ss%2Fword@localhost:5432/open-mercato'
  const rewritten = rewriteDatabaseUrl(url, 'client_a')
  const parsed = new URL(rewritten)
  assert.equal(parsed.username, 'user')
  assert.equal(decodeURIComponent(parsed.password), 'p@ss/word')
  assert.equal(parsed.pathname, '/client_a')
})

test('rewriteDatabaseUrl: preserves query string (?schema=custom) and host', () => {
  const url = 'postgres://postgres:postgres@db.internal:6432/open-mercato?schema=custom&sslmode=require'
  const rewritten = rewriteDatabaseUrl(url, 'client_a')
  const parsed = new URL(rewritten)
  assert.equal(parsed.host, 'db.internal:6432')
  assert.equal(parsed.pathname, '/client_a')
  assert.equal(parsed.searchParams.get('schema'), 'custom')
  assert.equal(parsed.searchParams.get('sslmode'), 'require')
})

test('rewriteDatabaseUrl: rejects empty input', () => {
  assert.throws(() => rewriteDatabaseUrl('', 'x'), /empty/i)
})

test('updateDatabaseUrlInEnvText: rewrites a plain DATABASE_URL line', () => {
  const source = [
    '# header',
    'POSTGRES_USER=postgres',
    'DATABASE_URL=postgres://postgres:postgres@localhost:5432/open-mercato',
    'JWT_SECRET=abc',
  ].join('\n')
  const result = updateDatabaseUrlInEnvText(source, 'client_a')
  assert.equal(result.changed, true)
  assert.match(result.text, /^DATABASE_URL=postgres:\/\/postgres:postgres@localhost:5432\/client_a$/m)
  assert.match(result.text, /JWT_SECRET=abc/)
})

test('updateDatabaseUrlInEnvText: preserves quotes and trailing comments', () => {
  const source = 'DATABASE_URL="postgres://u:p@h:5432/db" # comment'
  const result = updateDatabaseUrlInEnvText(source, 'new_db')
  assert.match(result.text, /DATABASE_URL="postgres:\/\/u:p@h:5432\/new_db"/)
})

test('updateDatabaseUrlInEnvText: only rewrites the first DATABASE_URL occurrence', () => {
  const source = [
    'DATABASE_URL=postgres://a:b@c:5432/old1',
    'DATABASE_URL=postgres://a:b@c:5432/old2',
  ].join('\n')
  const result = updateDatabaseUrlInEnvText(source, 'new_db')
  const lines = result.text.split('\n')
  assert.equal(lines[0], 'DATABASE_URL=postgres://a:b@c:5432/new_db')
  assert.equal(lines[1], 'DATABASE_URL=postgres://a:b@c:5432/old2')
})

test('updateDatabaseUrlInEnvText: changed=false when database name already matches', () => {
  const source = 'DATABASE_URL=postgres://a:b@c:5432/already_set'
  const result = updateDatabaseUrlInEnvText(source, 'already_set')
  assert.equal(result.changed, false)
})

test('updateDatabaseUrlInEnvText: throws when no DATABASE_URL line exists', () => {
  assert.throws(() => updateDatabaseUrlInEnvText('OTHER=x', 'foo'), /No DATABASE_URL/)
})

test('readEnvDatabaseUrl: returns the value, stripping quotes', () => {
  assert.equal(
    readEnvDatabaseUrl('DATABASE_URL="postgres://x:y@z:5432/a"'),
    'postgres://x:y@z:5432/a',
  )
  assert.equal(
    readEnvDatabaseUrl('export DATABASE_URL=postgres://x:y@z:5432/a'),
    'postgres://x:y@z:5432/a',
  )
  assert.equal(readEnvDatabaseUrl('OTHER=1'), null)
})

test('isNonInteractiveEnvironment: detects CI=true and missing TTY', () => {
  assert.equal(isNonInteractiveEnvironment({ env: { CI: 'true' }, stdinIsTTY: true }), true)
  assert.equal(isNonInteractiveEnvironment({ env: { CI: '1' }, stdinIsTTY: true }), true)
  assert.equal(isNonInteractiveEnvironment({ env: {}, stdinIsTTY: false }), true)
  assert.equal(isNonInteractiveEnvironment({ env: {}, stdinIsTTY: true }), false)
})

test('parseUpdateEnvAnswer: yes/no aliases and default-yes for empty', () => {
  assert.equal(parseUpdateEnvAnswer(''), true)
  assert.equal(parseUpdateEnvAnswer('y'), true)
  assert.equal(parseUpdateEnvAnswer('Yes'), true)
  assert.equal(parseUpdateEnvAnswer('1'), true)
  assert.equal(parseUpdateEnvAnswer('TRUE'), true)
  assert.equal(parseUpdateEnvAnswer('n'), false)
  assert.equal(parseUpdateEnvAnswer('No'), false)
  assert.equal(parseUpdateEnvAnswer('0'), false)
  assert.equal(parseUpdateEnvAnswer('false'), false)
  assert.equal(parseUpdateEnvAnswer('maybe'), null)
})

test('resolveUpdateEnvDecisionFromEnv / readDatabaseNameEnvOverride: env-based defaults', () => {
  assert.equal(resolveUpdateEnvDecisionFromEnv({ OM_DEV_DATABASE_UPDATE_ENV: 'true' }), true)
  assert.equal(resolveUpdateEnvDecisionFromEnv({ OM_DEV_DATABASE_UPDATE_ENV: 'no' }), false)
  assert.equal(resolveUpdateEnvDecisionFromEnv({}), null)
  assert.equal(readDatabaseNameEnvOverride({ OM_DEV_DATABASE_NAME: 'foo' }), 'foo')
  assert.equal(readDatabaseNameEnvOverride({ OM_DEV_DATABASE_NAME: '   ' }), null)
  assert.equal(readDatabaseNameEnvOverride({}), null)
})

test('resolveDatabaseNameOverride: omitted flag is a no-op', async () => {
  const result = await resolveDatabaseNameOverride({
    argv: ['--greenfield'],
    env: {},
    cwd: '/tmp/whatever',
    envFilePath: null,
  })
  assert.equal(result.applied, false)
  assert.deepEqual(result.remainingArgv, ['--greenfield'])
})

test('resolveDatabaseNameOverride: explicit name updates env file when --update-env', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-db-url-'))
  const envPath = path.join(root, '.env')
  fs.writeFileSync(
    envPath,
    'POSTGRES_USER=postgres\nDATABASE_URL=postgres://postgres:postgres@localhost:5432/open-mercato\nJWT_SECRET=x\n',
  )

  try {
    const logs = []
    const result = await resolveDatabaseNameOverride({
      argv: ['--database-name=client_a', '--update-env'],
      env: {},
      cwd: root,
      envFilePath: envPath,
      logger: { info: (msg) => logs.push(msg) },
    })

    assert.equal(result.applied, true)
    assert.equal(result.databaseName, 'client_a')
    assert.equal(result.source, 'explicit')
    assert.equal(result.envFileUpdated, true)
    assert.equal(result.envFileWriteSkipped, false)
    assert.equal(
      result.childEnv.DATABASE_URL,
      'postgres://postgres:postgres@localhost:5432/client_a',
    )
    const updated = fs.readFileSync(envPath, 'utf8')
    assert.match(updated, /DATABASE_URL=postgres:\/\/postgres:postgres@localhost:5432\/client_a/)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('resolveDatabaseNameOverride: bare --database-name derives from CWD', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-db-url-cwd-'))
  const projectDir = path.join(root, 'Client-Beta')
  fs.mkdirSync(projectDir, { recursive: true })
  const envPath = path.join(projectDir, '.env')
  fs.writeFileSync(envPath, 'DATABASE_URL=postgres://postgres:postgres@localhost:5432/open-mercato\n')

  try {
    const result = await resolveDatabaseNameOverride({
      argv: ['--database-name', '--update-env'],
      env: {},
      cwd: projectDir,
      envFilePath: envPath,
    })

    assert.equal(result.applied, true)
    assert.equal(result.databaseName, 'client_beta')
    assert.equal(result.source, 'cwd')
    assert.equal(result.envFileUpdated, true)
    assert.equal(
      result.childEnv.DATABASE_URL,
      'postgres://postgres:postgres@localhost:5432/client_beta',
    )
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('resolveDatabaseNameOverride: --no-update-env keeps file untouched but injects child env', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-db-url-skip-'))
  const envPath = path.join(root, '.env')
  const original = 'DATABASE_URL=postgres://postgres:postgres@localhost:5432/open-mercato\n'
  fs.writeFileSync(envPath, original)

  try {
    const result = await resolveDatabaseNameOverride({
      argv: ['--database-name=temp_run', '--no-update-env'],
      env: {},
      cwd: root,
      envFilePath: envPath,
    })

    assert.equal(result.applied, true)
    assert.equal(result.envFileUpdated, false)
    assert.equal(result.envFileWriteSkipped, true)
    assert.equal(
      result.childEnv.DATABASE_URL,
      'postgres://postgres:postgres@localhost:5432/temp_run',
    )
    assert.equal(fs.readFileSync(envPath, 'utf8'), original)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('resolveDatabaseNameOverride: non-interactive run defaults to update without prompting', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-db-url-ni-'))
  const envPath = path.join(root, '.env')
  fs.writeFileSync(envPath, 'DATABASE_URL=postgres://postgres:postgres@localhost:5432/open-mercato\n')

  try {
    const result = await resolveDatabaseNameOverride({
      argv: ['--database-name=auto'],
      env: { CI: 'true' },
      cwd: root,
      envFilePath: envPath,
    })

    assert.equal(result.envFileUpdated, true)
    assert.match(fs.readFileSync(envPath, 'utf8'), /\/auto/)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('resolveDatabaseNameOverride: invalid explicit name throws and leaves file untouched', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-db-url-invalid-'))
  const envPath = path.join(root, '.env')
  const original = 'DATABASE_URL=postgres://postgres:postgres@localhost:5432/open-mercato\n'
  fs.writeFileSync(envPath, original)

  try {
    await assert.rejects(
      () => resolveDatabaseNameOverride({
        argv: ['--database-name=bad name'],
        env: {},
        cwd: root,
        envFilePath: envPath,
      }),
      /Invalid database name/,
    )
    assert.equal(fs.readFileSync(envPath, 'utf8'), original)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('resolveDatabaseNameOverride: missing env file fails closed without writes', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-db-url-noenv-'))
  try {
    await assert.rejects(
      () => resolveDatabaseNameOverride({
        argv: ['--database-name=any'],
        env: {},
        cwd: root,
        envFilePath: path.join(root, '.env'),
      }),
      /Env file not found/,
    )
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('resolveDatabaseNameOverride: OM_DEV_DATABASE_NAME env var triggers override when CLI flag is absent', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-db-url-envvar-'))
  const envPath = path.join(root, '.env')
  fs.writeFileSync(envPath, 'DATABASE_URL=postgres://postgres:postgres@localhost:5432/open-mercato\n')

  try {
    const result = await resolveDatabaseNameOverride({
      argv: [],
      env: { OM_DEV_DATABASE_NAME: 'from_env', CI: 'true' },
      cwd: root,
      envFilePath: envPath,
    })

    assert.equal(result.applied, true)
    assert.equal(result.databaseName, 'from_env')
    assert.equal(result.envFileUpdated, true)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('collectForwardedSetupFlags: forwards --database-name=<value> verbatim', () => {
  assert.deepEqual(
    collectForwardedSetupFlags(['--reinstall', '--database-name=client_a', '--classic']),
    ['--database-name=client_a'],
  )
})

test('collectForwardedSetupFlags: forwards bare --database-name (no value)', () => {
  assert.deepEqual(
    collectForwardedSetupFlags(['--database-name']),
    ['--database-name'],
  )
})

test('collectForwardedSetupFlags: forwards --database-name with positional value', () => {
  assert.deepEqual(
    collectForwardedSetupFlags(['--database-name', 'client_b', '--reinstall']),
    ['--database-name', 'client_b'],
  )
})

test('collectForwardedSetupFlags: does not consume next flag as value', () => {
  assert.deepEqual(
    collectForwardedSetupFlags(['--database-name', '--no-update-env']),
    ['--database-name', '--no-update-env'],
  )
})

test('collectForwardedSetupFlags: forwards --update-env / --no-update-env', () => {
  assert.deepEqual(
    collectForwardedSetupFlags(['--no-update-env']),
    ['--no-update-env'],
  )
  assert.deepEqual(
    collectForwardedSetupFlags(['--update-env']),
    ['--update-env'],
  )
})

test('collectForwardedSetupFlags: returns empty when none of the flags are present', () => {
  assert.deepEqual(
    collectForwardedSetupFlags(['--reinstall', '--classic']),
    [],
  )
})

test('resolveDatabaseNameOverride: CLI flag wins over OM_DEV_DATABASE_NAME', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-db-url-cli-wins-'))
  const envPath = path.join(root, '.env')
  fs.writeFileSync(envPath, 'DATABASE_URL=postgres://postgres:postgres@localhost:5432/open-mercato\n')

  try {
    const result = await resolveDatabaseNameOverride({
      argv: ['--database-name=cli_wins', '--update-env'],
      env: { OM_DEV_DATABASE_NAME: 'env_loses' },
      cwd: root,
      envFilePath: envPath,
    })

    assert.equal(result.databaseName, 'cli_wins')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
