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

for (const scenario of ['declined', 'noninteractive', 'active owner', 'occupied endpoint', 'reused PID', 'PID reused before heartbeat', 'other workspace']) {
  test(`recovery never signals ${scenario}`, async (context) => {
    const fixture = orphanFixture(context)
    if (scenario === 'declined') fixture.dependencies.confirm = async () => false
    if (scenario === 'noninteractive') fixture.dependencies.interactive = false
    if (scenario === 'active owner') fs.writeFileSync(fixture.ownerPath, JSON.stringify({ ...fixture.owner, role: 'dev-runner', transferredAt: undefined }))
    if (scenario === 'occupied endpoint') fixture.dependencies.endpointAvailable = async () => false
    if (scenario === 'reused PID') fixture.record.startedAt = new Date(Date.now() + 20_000).toString()
    if (scenario === 'PID reused before heartbeat') {
      const memberPath = path.join(fixture.lockDirectory, 'members', `${process.pid}.json`)
      const member = JSON.parse(fs.readFileSync(memberPath, 'utf8'))
      fs.writeFileSync(memberPath, JSON.stringify({ ...member, registeredAt: new Date(Date.now() - 20000).toISOString() }))
    }
    if (scenario === 'other workspace') fixture.dependencies.processWorkspace = () => '/another-workspace'
    await assert.rejects(acquireDevSessionWithRecovery({ workspaceRoot: fixture.workspaceRoot, token: null }, fixture.dependencies), DevSessionConflictError)
    assert.deepEqual(fixture.signals, [])
    assert.equal(fs.existsSync(fixture.ownerPath), true)
  })
}

test('a new owner acquired while consent was pending is never signaled', async (context) => {
  const fixture = orphanFixture(context)
  fixture.dependencies.confirm = async () => {
    fs.writeFileSync(fixture.ownerPath, JSON.stringify({ ...fixture.owner, token: randomUUID() }))
    return true
  }
  await assert.rejects(acquireDevSessionWithRecovery({ workspaceRoot: fixture.workspaceRoot, token: null }, fixture.dependencies), DevSessionConflictError)
  assert.deepEqual(fixture.signals, [])
})
