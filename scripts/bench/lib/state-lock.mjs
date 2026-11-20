import { closeSync, mkdirSync, openSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export async function withDatasetLock(statePath, work) {
  const lockPath = `${statePath}.lock`
  mkdirSync(path.dirname(lockPath), { recursive: true })
  let descriptor
  try {
    descriptor = openSync(lockPath, 'wx', 0o600)
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error(`[internal] Dataset state is locked: ${lockPath}. Wait for its owner; remove the lock only after confirming all previous writes have settled.`)
    throw error
  }
  try {
    writeFileSync(descriptor, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }))
    return await work()
  } finally {
    closeSync(descriptor)
    unlinkSync(lockPath)
  }
}
