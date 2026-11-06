import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { acquireDevSessionWithRecovery } from '../dev-session-recovery.mjs'
import { DevSessionConflictError } from '../dev-session-guard.mjs'
import { inspectProcessTree } from '../dev-shutdown-utils.mjs'

function isRunning(pid) {
  return inspectProcessTree(pid).some((record) => record.pid === pid)
}

async function waitUntil(predicate, message) {
  const deadline = Date.now() + 4000
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  assert.fail(message)
}

async function createOrphanFixture(context, lateFork = false) {
  if (process.platform === 'win32') {
    context.skip('POSIX orphan recovery requires process identity and cwd inspection')
    return null
  }
  const workspaceRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-recovery-processes-')))
  const pidsPath = path.join(workspaceRoot, 'processes.json')
  const leafSource = "process.on('SIGTERM', () => {}); process.send('ready'); setInterval(() => {}, 1000)"
  const wrapperSource = `
    const { spawn } = require('node:child_process')
    const fs = require('node:fs')
    const startLeaf = () => {
      const leaf = spawn(process.execPath, ['-e', ${JSON.stringify(leafSource)}], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] })
      leaf.once('message', () => {
        const pids = { wrapper: process.pid, leaf: leaf.pid }
        if (${lateFork}) fs.writeFileSync(${JSON.stringify(pidsPath)}, JSON.stringify(pids))
        else process.send(pids)
      })
    }
    if (${lateFork}) {
      process.send({ wrapper: process.pid })
      process.on('SIGTERM', startLeaf)
    } else {
      startLeaf()
      process.on('SIGTERM', () => process.exit(0))
    }
    setInterval(() => {}, 1000)
  `
  const intermediarySource = `
    const { spawn } = require('node:child_process')
    const fs = require('node:fs')
    const wrapper = spawn(process.execPath, ['-e', ${JSON.stringify(wrapperSource)}], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] })
    wrapper.once('message', (pids) => {
      fs.writeFileSync(${JSON.stringify(pidsPath)}, JSON.stringify(pids))
      process.exit(0)
    })
  `
  const unrelated = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
  const intermediary = spawn(process.execPath, ['-e', intermediarySource], { cwd: workspaceRoot, stdio: 'ignore' })
  let pids
  context.after(() => {
    for (const pid of [fs.existsSync(pidsPath) ? JSON.parse(fs.readFileSync(pidsPath, 'utf8')).leaf : null, pids?.leaf, pids?.wrapper, intermediary.pid, unrelated.pid]) {
      if (pid) {
        try { process.kill(pid, 'SIGKILL') } catch {}
      }
    }
    fs.rmSync(workspaceRoot, { recursive: true, force: true })
  })
  await waitUntil(() => fs.existsSync(pidsPath), 'controlled orphan did not report readiness')
  pids = JSON.parse(fs.readFileSync(pidsPath, 'utf8'))
  await waitUntil(() => !isRunning(intermediary.pid), 'intermediary did not exit')
  const wrapper = inspectProcessTree(pids.wrapper).find((record) => record.pid === pids.wrapper)
  if (wrapper?.parentPid !== 1 && !lateFork) {
    context.skip('host reparented the controlled orphan to a subreaper instead of PID 1')
    return null
  }
  const lockDirectory = path.join(workspaceRoot, '.mercato', 'dev-session.lock')
  const membersDirectory = path.join(lockDirectory, 'members')
  fs.mkdirSync(membersDirectory, { recursive: true })
  const owner = {
    token: randomUUID(), pid: pids.wrapper, role: 'MCP server', mode: 'dev:direct:compact',
    workspaceRoot, url: 'http://localhost:3000', transferredAt: new Date().toISOString(),
    startedAt: new Date(Date.now() - 10000).toISOString(),
  }
  const ownerPath = path.join(lockDirectory, 'owner.json')
  fs.writeFileSync(ownerPath, JSON.stringify(owner))
  fs.writeFileSync(path.join(membersDirectory, `${pids.wrapper}.json`), JSON.stringify({
    pid: pids.wrapper, token: owner.token, role: 'MCP server', heartbeatAt: new Date().toISOString(),
  }))
  return { workspaceRoot, owner, ownerPath, membersDirectory, pids, unrelated }
}

test('confirmed recovery waits for a resistant unrecorded descendant before acquiring ownership', async (context) => {
  const fixture = await createOrphanFixture(context)
  if (!fixture) return
  const { workspaceRoot, pids, unrelated } = fixture
  let session
  try {
    session = await acquireDevSessionWithRecovery({ workspaceRoot, token: null }, {
      interactive: true, processWorkspace: () => workspaceRoot, confirm: async () => true, endpointAvailable: async () => true, graceMs: 100,
    })
    assert.equal(isRunning(pids.wrapper), false, 'recorded wrapper survived recovery')
    assert.equal(isRunning(pids.leaf), false, 'unrecorded descendant survived successful recovery')
    assert.equal(isRunning(unrelated.pid), true, 'unrelated process was signaled')
  } finally {
    session?.release()
  }
})

for (const change of ['owner changed', 'member joined']) {
  test(`recovery does not signal a process tree when ${change} during consent`, async (context) => {
    const fixture = await createOrphanFixture(context)
    if (!fixture) return
    const { workspaceRoot, owner, ownerPath, membersDirectory, pids, unrelated } = fixture
    await assert.rejects(acquireDevSessionWithRecovery({ workspaceRoot, token: null }, {
      interactive: true,
      processWorkspace: () => workspaceRoot,
      endpointAvailable: async () => true,
      confirm: async () => {
        if (change === 'owner changed') {
          fs.writeFileSync(ownerPath, JSON.stringify({ ...owner, token: randomUUID() }))
        } else {
          fs.writeFileSync(path.join(membersDirectory, `${unrelated.pid}.json`), JSON.stringify({
            pid: unrelated.pid, token: owner.token, role: 'new managed child', heartbeatAt: new Date().toISOString(),
          }))
        }
        return true
      },
      graceMs: 100,
    }), DevSessionConflictError)
    assert.equal(isRunning(pids.wrapper), true)
    assert.equal(isRunning(pids.leaf), true)
    assert.equal(isRunning(unrelated.pid), true)
  })
}

test('recovery retains a late descendant after its TERM-handling parent exits', async (context) => {
  const fixture = await createOrphanFixture(context, true)
  if (!fixture) return
  const { workspaceRoot, pids, membersDirectory, unrelated } = fixture
  let observed = false
  let retained = false
  let session
  try {
    session = await acquireDevSessionWithRecovery({ workspaceRoot, token: null }, {
      interactive: true, processWorkspace: () => workspaceRoot, confirm: async () => true,
      endpointAvailable: async () => true, graceMs: 500,
      inspectTree: (pid) => {
        const tree = inspectProcessTree(pid).map((row) => row.pid === pids.wrapper ? { ...row, parentPid: 1 } : row)
        if (!observed && pid === pids.wrapper && tree.length > 1) {
          observed = true
          setTimeout(() => {
            retained = fs.existsSync(path.join(membersDirectory, `${tree.find((row) => row.pid !== pids.wrapper).pid}.json`))
            try { process.kill(pids.wrapper, 'SIGKILL') } catch {}
          }, 0)
        }
        return tree
      },
    })
    const latePids = JSON.parse(fs.readFileSync(path.join(workspaceRoot, 'processes.json'), 'utf8'))
    assert.equal(observed, true, 'late descendant was never observed with its parent')
    assert.equal(retained, true, 'late descendant was not registered before its parent exited')
    assert.equal(isRunning(pids.wrapper), false)
    assert.equal(isRunning(latePids.leaf), false, 'late descendant survived successful acquisition')
    assert.equal(isRunning(unrelated.pid), true, 'unrelated process was signaled')
  } finally {
    session?.release()
  }
})
