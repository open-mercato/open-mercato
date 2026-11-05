import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const LOCK_DIRECTORY_NAME = 'dev-session.lock'
const OWNER_FILE_NAME = 'owner.json'
const MEMBERS_DIRECTORY_NAME = 'members'
const HEARTBEAT_INTERVAL_MS = 5_000
const OWNER_WRITE_GRACE_MS = 5_000
const ACQUISITION_DIRECTORY_NAME = 'dev-session-acquire.lock'
const ACQUISITION_TIMEOUT_MS = 5_000
const ACQUISITION_POLL_MS = 10

function canonicalizeWorkspaceRoot(workspaceRoot) {
  const resolved = path.resolve(workspaceRoot)
  try {
    return fs.realpathSync.native(resolved)
  } catch {
    return fs.realpathSync(resolved)
  }
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return null
  }
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

function writeJsonAtomically(filePath, value) {
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  fs.renameSync(temporaryPath, filePath)
}

function readMembers(lockDirectory) {
  const membersDirectory = path.join(lockDirectory, MEMBERS_DIRECTORY_NAME)
  try {
    return fs.readdirSync(membersDirectory)
      .filter((entry) => /^\d+\.json$/.test(entry))
      .map((entry) => readJsonFile(path.join(membersDirectory, entry)))
      .filter((entry) => entry && Number.isInteger(entry.pid) && entry.pid > 0)
  } catch {
    return []
  }
}

function findLiveMember(lockDirectory, owner) {
  const candidates = [owner, ...readMembers(lockDirectory)].filter(Boolean)
  return candidates.find((candidate) => isProcessAlive(candidate.pid)) ?? null
}

function removeStaleLock(lockDirectory) {
  const staleDirectory = `${lockDirectory}.stale-${process.pid}-${randomUUID()}`
  fs.renameSync(lockDirectory, staleDirectory)
  fs.rmSync(staleDirectory, { recursive: true, force: true })
}

function withSessionAcquisition(lockDirectory, operation) {
  const stateDirectory = path.dirname(lockDirectory)
  const acquisitionDirectory = path.join(stateDirectory, ACQUISITION_DIRECTORY_NAME)
  const candidateDirectory = fs.mkdtempSync(path.join(stateDirectory, '.dev-session-acquire-'))
  const deadline = Date.now() + ACQUISITION_TIMEOUT_MS
  const waitState = new Int32Array(new SharedArrayBuffer(4))
  let acquired = false

  try {
    fs.writeFileSync(path.join(candidateDirectory, OWNER_FILE_NAME), JSON.stringify({
      pid: process.pid,
      token: randomUUID(),
      mode: 'claiming',
    }), { mode: 0o600 })

    while (!acquired) {
      if (Date.now() >= deadline) {
        throw new DevSessionConflictError(readJsonFile(path.join(acquisitionDirectory, OWNER_FILE_NAME)), path.dirname(stateDirectory))
      }
      try {
        fs.renameSync(candidateDirectory, acquisitionDirectory)
        acquired = true
        break
      } catch (error) {
        if (!['EEXIST', 'ENOTEMPTY', 'EPERM', 'EACCES'].includes(error?.code)) throw error
      }

      try {
        const generation = fs.statSync(acquisitionDirectory, { bigint: true })
        const owner = readJsonFile(path.join(acquisitionDirectory, OWNER_FILE_NAME))
        if (typeof owner?.token === 'string' && /^[0-9a-f-]{36}$/i.test(owner.token) && Number.isInteger(owner.pid) && !isProcessAlive(owner.pid)) {
          const currentOwner = readJsonFile(path.join(acquisitionDirectory, OWNER_FILE_NAME))
          const currentGeneration = fs.statSync(acquisitionDirectory, { bigint: true })
          if (currentOwner?.token !== owner.token || currentGeneration.dev !== generation.dev || currentGeneration.ino !== generation.ino) continue
          const staleDirectory = path.join(stateDirectory, `.dev-session-acquire.stale-${generation.dev}-${generation.ino}-${owner.token}`)
          try {
            fs.renameSync(acquisitionDirectory, staleDirectory)
          } catch (error) {
            if (error?.code !== 'ENOENT' && !(['EEXIST', 'ENOTEMPTY', 'EPERM', 'EACCES'].includes(error?.code) && fs.existsSync(staleDirectory))) throw error
          }
          continue
        }
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error
      }
      Atomics.wait(waitState, 0, 0, ACQUISITION_POLL_MS)
    }

    return operation()
  } finally {
    if (acquired) fs.renameSync(acquisitionDirectory, candidateDirectory)
    fs.rmSync(candidateDirectory, { recursive: true, force: true })
  }
}

function registerMember(lockDirectory, token, pid, role) {
  const owner = readJsonFile(path.join(lockDirectory, OWNER_FILE_NAME))
  if (!owner || owner.token !== token) return null

  const membersDirectory = path.join(lockDirectory, MEMBERS_DIRECTORY_NAME)
  fs.mkdirSync(membersDirectory, { recursive: true })
  const memberPath = path.join(membersDirectory, `${pid}.json`)
  writeJsonAtomically(memberPath, {
    pid,
    role,
    token,
    heartbeatAt: new Date().toISOString(),
  })
  return memberPath
}

export class DevSessionConflictError extends Error {
  constructor(owner, workspaceRoot) {
    const pid = Number.isInteger(owner?.pid) ? owner.pid : 'unknown'
    const mode = typeof owner?.mode === 'string' && owner.mode ? owner.mode : 'unknown'
    const url = typeof owner?.url === 'string' && owner.url ? owner.url : 'unavailable'
    super([
      `Another Open Mercato dev session already owns this workspace (PID ${pid}, mode ${mode}, URL ${url}).`,
      'Stop that session with Ctrl+C and retry, or use an isolated checkout with a separate database.',
      `Workspace: ${workspaceRoot}`,
      'The conflicting launch stopped before build artifacts, runtime files, or the database were changed.',
    ].join('\n'))
    this.name = 'DevSessionConflictError'
    this.owner = owner
    this.workspaceRoot = workspaceRoot
  }
}

function createHandle({ lockDirectory, owner, ownsLock, role }) {
  const trackedMembers = new Map()
  let released = false

  const trackPid = (pid, memberRole) => {
    if (!Number.isInteger(pid) || pid <= 0 || released) return null
    const memberPath = registerMember(lockDirectory, owner.token, pid, memberRole)
    if (!memberPath) return null
    trackedMembers.set(pid, { memberPath, role: memberRole })
    return memberPath
  }

  trackPid(process.pid, role)

  const heartbeat = setInterval(() => {
    for (const [pid, member] of trackedMembers) {
      if (!isProcessAlive(pid)) {
        trackedMembers.delete(pid)
        fs.rmSync(member.memberPath, { force: true })
        continue
      }
      registerMember(lockDirectory, owner.token, pid, member.role)
    }
  }, HEARTBEAT_INTERVAL_MS)
  heartbeat.unref?.()

  return {
    token: owner.token,
    workspaceRoot: owner.workspaceRoot,
    owner,
    childEnv: {
      OM_DEV_SESSION_TOKEN: owner.token,
      OM_DEV_SESSION_WORKSPACE_ROOT: owner.workspaceRoot,
    },
    registerChild(child, childRole = 'managed-child') {
      const pid = child?.pid
      const memberPath = trackPid(pid, childRole)
      if (!memberPath || typeof child?.once !== 'function') return
      child.once('close', () => {
        trackedMembers.delete(pid)
        fs.rmSync(memberPath, { force: true })
      })
    },
    release() {
      if (released) return
      return withSessionAcquisition(lockDirectory, () => {
        released = true
        clearInterval(heartbeat)
        for (const [pid, member] of trackedMembers) {
          if (pid === process.pid || !isProcessAlive(pid)) {
            fs.rmSync(member.memberPath, { force: true })
          }
        }
        trackedMembers.clear()
        const ownerPath = path.join(lockDirectory, OWNER_FILE_NAME)
        const currentOwner = readJsonFile(ownerPath)
        const canFinalizeOwnership = currentOwner?.token === owner.token
          && (ownsLock || (currentOwner.transferredAt && currentOwner.pid === process.pid))
        if (!canFinalizeOwnership) return

        const survivingMember = findLiveMember(lockDirectory, null)
        if (survivingMember) {
          writeJsonAtomically(ownerPath, {
            ...currentOwner,
            pid: survivingMember.pid,
            role: survivingMember.role,
            transferredAt: new Date().toISOString(),
          })
          return
        }
        fs.rmSync(lockDirectory, { recursive: true, force: true })
      })
    },
  }
}

export function acquireDevSession({
  workspaceRoot = process.cwd(),
  mode = 'dev',
  url = null,
  token = process.env.OM_DEV_SESSION_TOKEN?.trim() || null,
  role = 'dev-runner',
} = {}) {
  const canonicalWorkspaceRoot = canonicalizeWorkspaceRoot(workspaceRoot)
  const stateDirectory = path.join(canonicalWorkspaceRoot, '.mercato')
  const lockDirectory = path.join(stateDirectory, LOCK_DIRECTORY_NAME)
  fs.mkdirSync(stateDirectory, { recursive: true })

  return withSessionAcquisition(lockDirectory, () => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        fs.mkdirSync(lockDirectory)
        fs.mkdirSync(path.join(lockDirectory, MEMBERS_DIRECTORY_NAME))
        const owner = {
          version: 1,
          token: token || randomUUID(),
          pid: process.pid,
          mode,
          url,
          workspaceRoot: canonicalWorkspaceRoot,
          startedAt: new Date().toISOString(),
        }
        writeJsonAtomically(path.join(lockDirectory, OWNER_FILE_NAME), owner)
        return createHandle({ lockDirectory, owner, ownsLock: true, role })
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error
      }

      const ownerPath = path.join(lockDirectory, OWNER_FILE_NAME)
      const owner = readJsonFile(ownerPath)
      if (owner?.token && token && owner.token === token && owner.workspaceRoot === canonicalWorkspaceRoot) {
        return createHandle({ lockDirectory, owner, ownsLock: false, role })
      }

      const liveMember = findLiveMember(lockDirectory, owner)
      if (liveMember) {
        throw new DevSessionConflictError(owner ?? liveMember, canonicalWorkspaceRoot)
      }

      if (!owner) {
        const lockAgeMs = Date.now() - fs.statSync(lockDirectory).mtimeMs
        if (lockAgeMs < OWNER_WRITE_GRACE_MS) {
          throw new DevSessionConflictError({ mode: 'starting' }, canonicalWorkspaceRoot)
        }
      }

      try {
        removeStaleLock(lockDirectory)
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error
      }
    }

    throw new DevSessionConflictError(readJsonFile(path.join(lockDirectory, OWNER_FILE_NAME)), canonicalWorkspaceRoot)
  })
}
