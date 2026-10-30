import { spawnSync } from 'node:child_process'
import fs from 'node:fs'

export function readProcessTable() {
  if (process.platform === 'win32') {
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,@{Name="identity";Expression={$_.CreationDate.ToUniversalTime().ToString("o")}} | ConvertTo-Json -Compress'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 1_000, windowsHide: true,
    })
    if (result.error || result.status !== 0) return null
    try {
      const records = JSON.parse(result.stdout)
      return (Array.isArray(records) ? records : [records]).flatMap((entry) => {
        const startedAt = Date.parse(entry?.identity)
        if (!Number.isInteger(entry?.ProcessId) || !Number.isFinite(startedAt)) return []
        return [{ pid: entry.ProcessId, ppid: entry.ParentProcessId, state: 'S', identity: new Date(startedAt).toISOString() }]
      })
    } catch {
      return null
    }
  }
  const result = spawnSync('ps', ['-A', '-o', 'pid=,ppid=,stat=,lstart='], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: 1_000,
    env: { ...process.env, LC_ALL: 'C' },
  })
  if (result.error || result.status !== 0) return null
  return result.stdout.split('\n').flatMap((line) => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+(.+)$/)
    if (!match) return []
    const startedAt = Date.parse(match[4])
    if (!Number.isFinite(startedAt)) return []
    return [{ pid: Number(match[1]), ppid: Number(match[2]), state: match[3], identity: new Date(startedAt).toISOString() }]
  })
}

export function getProcessIdentity(pid) {
  return readProcessTable()?.find((entry) => entry.pid === pid)?.identity ?? null
}

export function matchesProcessRecord(record, processes = readProcessTable()) {
  if (!Number.isInteger(record?.pid) || record.pid <= 0) return false
  if (processes) {
    const current = processes.find((entry) => entry.pid === record.pid)
    if (current) {
      if (current.state.startsWith('Z')) return false
      if (record.processIdentity) return record.processIdentity === current.identity
      const recordedAt = Date.parse(record.registeredAt ?? record.startedAt ?? record.heartbeatAt)
      return !Number.isFinite(recordedAt) || Date.parse(current.identity) <= recordedAt + 1_000
    }
  }
  try {
    process.kill(record.pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}


export function readSessionProcessTable(token, ownerPid = null) {
  if (typeof token !== 'string' || !/^[0-9a-f-]{36}$/i.test(token)) return []
  const processes = readProcessTable()
  if (!processes) return []
  const matches = (environment) => environment.includes(`OM_DEV_SESSION_TOKEN=${token}`)
    && (ownerPid === null || environment.includes(`OM_DEV_PROCESS_OWNER_PID=${ownerPid}`))
  if (process.platform === 'linux') {
    return processes.filter((entry) => {
      try { return matches(fs.readFileSync(`/proc/${entry.pid}/environ`, 'utf8').split('\0')) }
      catch { return false }
    })
  }
  if (process.platform === 'win32') return []
  const result = spawnSync('ps', ['eww', '-A', '-o', 'pid=,command='], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 1_000, maxBuffer: 32 * 1024 * 1024,
  })
  if (result.error || result.status !== 0) return []
  const sessionPids = new Set(result.stdout.split('\n').flatMap((line) => {
    const match = line.trim().match(/^(\d+)\s+(.+)$/)
    return match && matches(match[2].split(/\s+/)) ? [Number(match[1])] : []
  }))
  return processes.filter((entry) => sessionPids.has(entry.pid))
}
