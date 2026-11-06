import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { acquireDevSessionWithRecovery } from '../dev-session-recovery.mjs'
import { DevSessionConflictError } from '../dev-session-guard.mjs'

function orphanFixture(context) {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'om-session-recovery-'))
  const lockDirectory = path.join(workspaceRoot, '.mercato', 'dev-session.lock')
  const membersDirectory = path.join(lockDirectory, 'members')
  fs.mkdirSync(membersDirectory, { recursive: true })
  const owner = {
    token: randomUUID(), pid: process.pid, role: 'MCP server', mode: 'dev:direct:compact',
    workspaceRoot, url: 'http://localhost:3000', transferredAt: new Date().toISOString(),
    startedAt: new Date(Date.now() - 20_000).toISOString(),
  }
  const ownerPath = path.join(lockDirectory, 'owner.json')
  fs.writeFileSync(ownerPath, JSON.stringify(owner))
  const memberPath = path.join(membersDirectory, `${process.pid}.json`)
  fs.writeFileSync(memberPath, JSON.stringify({ ...owner, heartbeatAt: new Date().toISOString() }))
  const record = { pid: process.pid, parentPid: 1, startedAt: new Date(Date.now() - 10_000).toString(), command: 'node MCP server' }
  const signals = []
  let running = true
  const dependencies = {
    interactive: true,
    confirm: async () => true,
    endpointAvailable: async () => true,
    inspectTree: () => running ? [record] : [],
    processWorkspace: () => workspaceRoot,
    signalTree: (records, signal) => {
      signals.push({ records, signal })
      running = false
      fs.rmSync(memberPath, { force: true })
      fs.writeFileSync(ownerPath, JSON.stringify({ ...owner, pid: 2147483647 }))
      return true
    },
    output: { write() {} },
    graceMs: 0,
  }
  context.after(() => fs.rmSync(workspaceRoot, { recursive: true, force: true }))
  return { workspaceRoot, lockDirectory, owner, ownerPath, record, signals, dependencies }
}

test('confirmed orphan recovery resumes acquisition after cleanup', async (context) => {
  const fixture = orphanFixture(context)
  let prompts = 0
  fixture.dependencies.confirm = async (description) => {
    prompts++
    assert.match(description, /MCP server/)
    assert.match(description, /3000/)
    return true
  }
  const session = await acquireDevSessionWithRecovery({ workspaceRoot: fixture.workspaceRoot, token: null }, fixture.dependencies)
  assert.equal(prompts, 1)
  assert.equal(fixture.signals.length, 1)
  assert.equal(fixture.signals[0].signal, 'SIGTERM')
  assert.equal(fixture.signals[0].records[0].pid, process.pid)
  session.release()
})

test('orphaned app-runtime processes may have cwd inside the workspace app directory', async (context) => {
  const fixture = orphanFixture(context)
  const appDirectory = path.join(fixture.workspaceRoot, 'apps', 'mercato')
  fs.mkdirSync(appDirectory, { recursive: true })
  fixture.dependencies.processWorkspace = () => appDirectory
  const session = await acquireDevSessionWithRecovery({ workspaceRoot: fixture.workspaceRoot, token: null }, fixture.dependencies)
  session.release()
  assert.equal(fixture.signals.length, 1)
})

for (const scenario of ['declined', 'noninteractive', 'unverifiable workspace']) {
  test(`recovery never signals or unlocks when ${scenario}`, async (context) => {
    const fixture = orphanFixture(context)
    if (scenario === 'declined') fixture.dependencies.confirm = async () => false
    if (scenario === 'noninteractive') fixture.dependencies.interactive = false
    if (scenario === 'unverifiable workspace') {
      fixture.dependencies.processWorkspace = () => null
      fixture.dependencies.confirm = async () => assert.fail('an unverifiable session must not be offered for cleanup')
    }
    await assert.rejects(acquireDevSessionWithRecovery({ workspaceRoot: fixture.workspaceRoot, token: null }, fixture.dependencies), DevSessionConflictError)
    assert.deepEqual(fixture.signals, [])
    assert.equal(fs.existsSync(fixture.ownerPath), true)
  })
}

for (const scenario of ['active owner', 'occupied endpoint', 'setup owner without URL']) {
  test(`confirmed recovery stops a live ${scenario} session and continues`, async (context) => {
    const fixture = orphanFixture(context)
    const activeOwner = { ...fixture.owner, role: 'dev-runner', transferredAt: undefined }
    if (scenario === 'active owner') fs.writeFileSync(fixture.ownerPath, JSON.stringify(activeOwner))
    if (scenario === 'occupied endpoint') fixture.dependencies.endpointAvailable = async () => false
    if (scenario === 'setup owner without URL') {
      fs.writeFileSync(fixture.ownerPath, JSON.stringify({ ...activeOwner, role: 'starter', mode: 'setup:hybrid', url: null }))
      fixture.dependencies.endpointAvailable = async () => false
    }
    let description = ''
    fixture.dependencies.confirm = async (text) => {
      description = text
      return true
    }
    const session = await acquireDevSessionWithRecovery({ workspaceRoot: fixture.workspaceRoot, token: null }, fixture.dependencies)
    session.release()
    assert.match(description, /already owns this workspace/)
    assert.match(description, /still running in this workspace/)
    if (scenario === 'occupied endpoint') assert.match(description, /still serving/)
    if (scenario === 'setup owner without URL') assert.match(description, /mode setup:hybrid, URL unavailable/)
    assert.equal(fixture.signals.length, 1)
    assert.equal(fixture.signals[0].signal, 'SIGTERM')
  })
}

for (const scenario of ['reused PID', 'PID reused before heartbeat', 'other workspace']) {
  test(`confirmed recovery discards a stale lock without signaling when ${scenario}`, async (context) => {
    const fixture = orphanFixture(context)
    if (scenario === 'reused PID') fixture.record.startedAt = new Date(Date.now() + 20_000).toString()
    if (scenario === 'PID reused before heartbeat') {
      const memberPath = path.join(fixture.lockDirectory, 'members', `${process.pid}.json`)
      const member = JSON.parse(fs.readFileSync(memberPath, 'utf8'))
      fs.writeFileSync(memberPath, JSON.stringify({ ...member, registeredAt: new Date(Date.now() - 20000).toISOString() }))
    }
    if (scenario === 'other workspace') fixture.dependencies.processWorkspace = () => '/another-workspace'
    let description = ''
    fixture.dependencies.confirm = async (text) => {
      description = text
      return true
    }
    const session = await acquireDevSessionWithRecovery({ workspaceRoot: fixture.workspaceRoot, token: null }, fixture.dependencies)
    assert.match(description, /no longer running/)
    assert.match(description, /Clean up the stale session lock/)
    assert.deepEqual(fixture.signals, [])
    const owner = JSON.parse(fs.readFileSync(fixture.ownerPath, 'utf8'))
    assert.equal(owner.token, session.token)
    assert.notEqual(owner.token, fixture.owner.token)
    session.release()
    assert.equal(fs.existsSync(fixture.lockDirectory), false)
  })
}

test('declining a stale lock cleanup leaves the lock untouched', async (context) => {
  const fixture = orphanFixture(context)
  fixture.dependencies.processWorkspace = () => '/another-workspace'
  fixture.dependencies.confirm = async () => false
  await assert.rejects(acquireDevSessionWithRecovery({ workspaceRoot: fixture.workspaceRoot, token: null }, fixture.dependencies), DevSessionConflictError)
  assert.equal(JSON.parse(fs.readFileSync(fixture.ownerPath, 'utf8')).token, fixture.owner.token)
})

test('recovery refuses to stop the parent of the current launch', async (context) => {
  const fixture = orphanFixture(context)
  fixture.record.pid = process.ppid
  fixture.dependencies.inspectTree = () => [fixture.record, { ...fixture.record, pid: process.ppid, parentPid: 1 }].slice(1)
  fs.writeFileSync(fixture.ownerPath, JSON.stringify({ ...fixture.owner, pid: process.ppid }))
  fs.writeFileSync(path.join(fixture.lockDirectory, 'members', `${process.ppid}.json`), JSON.stringify({ ...fixture.owner, pid: process.ppid, heartbeatAt: new Date().toISOString() }))
  fs.rmSync(path.join(fixture.lockDirectory, 'members', `${process.pid}.json`))
  fixture.dependencies.confirm = async () => assert.fail('the parent launch must not be offered for cleanup')
  await assert.rejects(acquireDevSessionWithRecovery({ workspaceRoot: fixture.workspaceRoot, token: null }, fixture.dependencies), DevSessionConflictError)
  assert.deepEqual(fixture.signals, [])
})

test('recovery is idempotent: a second launch after cleanup acquires without prompting', async (context) => {
  const fixture = orphanFixture(context)
  const first = await acquireDevSessionWithRecovery({ workspaceRoot: fixture.workspaceRoot, token: null }, fixture.dependencies)
  first.release()
  fixture.dependencies.confirm = async () => assert.fail('no prompt expected once the workspace is free')
  const second = await acquireDevSessionWithRecovery({ workspaceRoot: fixture.workspaceRoot, token: null }, fixture.dependencies)
  second.release()
})

test('a new owner acquired while consent was pending is never signaled', async (context) => {
  const fixture = orphanFixture(context)
  fixture.dependencies.confirm = async () => {
    fs.writeFileSync(fixture.ownerPath, JSON.stringify({ ...fixture.owner, token: randomUUID() }))
    return true
  }
  await assert.rejects(acquireDevSessionWithRecovery({ workspaceRoot: fixture.workspaceRoot, token: null }, fixture.dependencies), DevSessionConflictError)
  assert.deepEqual(fixture.signals, [])
})
