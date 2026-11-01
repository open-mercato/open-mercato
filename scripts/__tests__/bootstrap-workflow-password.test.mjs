import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

function initializeScript(workflowPath) {
  const workflow = parse(fs.readFileSync(path.join(repoRoot, workflowPath), 'utf8'))
  const step = Object.values(workflow.jobs)
    .flatMap((job) => job.steps ?? [])
    .find((candidate) => candidate.name === 'Initialize standalone app database')
  assert.ok(step)
  return step.run
}

function runInitialization(script, password) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'om-bootstrap-workflow-'))
  try {
    const outputPath = path.join(tempDir, 'credentials.json')
    const jobEnvironmentPath = path.join(tempDir, 'job.env')
    fs.writeFileSync(path.join(tempDir, '.env'), 'NODE_ENV=test\n')
    fs.writeFileSync(path.join(tempDir, 'yarn'), [
      '#!/usr/bin/env node',
      'const fs = require("node:fs")',
      'fs.writeFileSync(process.env.OM_BOOTSTRAP_TEST_OUTPUT, JSON.stringify({password: process.env.OM_INIT_SUPERADMIN_PASSWORD, args: process.argv.slice(2)}), {mode: 0o600})',
    ].join('\n'), { mode: 0o700 })
    const environment = {
      ...process.env,
      PATH: `${tempDir}${path.delimiter}${process.env.PATH}`,
      OM_BOOTSTRAP_TEST_OUTPUT: outputPath,
      GITHUB_ENV: jobEnvironmentPath,
    }
    if (password === undefined) delete environment.OM_INIT_SUPERADMIN_PASSWORD
    else environment.OM_INIT_SUPERADMIN_PASSWORD = password
    const result = spawnSync('bash', ['-c', script], { cwd: tempDir, env: environment, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    const credential = JSON.parse(fs.readFileSync(outputPath, 'utf8'))
    assert.equal(result.stdout, `::add-mask::${credential.password}\n`)
    assert.deepEqual(credential.args, ['initialize'])
    const envContent = fs.readFileSync(path.join(tempDir, '.env'), 'utf8')
    assert.ok(envContent.includes(`OM_INIT_SUPERADMIN_PASSWORD=${credential.password}\n`))
    assert.equal(fs.readFileSync(jobEnvironmentPath, 'utf8'), `OM_INIT_SUPERADMIN_PASSWORD=${credential.password}\n`)
    assert.equal(fs.statSync(path.join(tempDir, '.env')).mode & 0o777, 0o600)
    return credential.password
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
}

for (const workflowPath of ['.github/workflows/snapshot.yml', '.github/workflows/npm-snapshot-preview.yml']) {
  test(`${workflowPath} provisions and retains a unique compliant bootstrap credential`, () => {
    const script = initializeScript(workflowPath)
    const firstPassword = runInitialization(script)
    const secondPassword = runInitialization(script)
    assert.notEqual(firstPassword, secondPassword)
    assert.ok(firstPassword.length >= 64)
    assert.match(firstPassword, /[A-Z]/)
    assert.match(firstPassword, /[0-9]/)
    assert.match(firstPassword, /[^A-Za-z0-9]/)
  })

  test(`${workflowPath} leaves explicit credentials to the CLI validator`, () => {
    const script = initializeScript(workflowPath)
    assert.equal(runInitialization(script, 'Operator-9qW!r2zT'), 'Operator-9qW!r2zT')
    assert.equal(runInitialization(script, ''), '')
  })
}
