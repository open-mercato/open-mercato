import defaultSpawn from 'cross-spawn'

export function parseProcessTreeMemoryBytes(output, rootPid) {
  const nodes = new Map()

  for (const rawLine of output.split('\n')) {
    const line = rawLine.trim()
    if (!line) continue

    const match = line.match(/^(\d+)\s+(\d+)\s+(\d+)$/)
    if (!match) continue

    const pid = Number.parseInt(match[1], 10)
    const ppid = Number.parseInt(match[2], 10)
    const rssKb = Number.parseInt(match[3], 10)
    nodes.set(pid, { ppid, rssKb })
  }

  if (!nodes.has(rootPid)) return null

  let totalKb = 0
  const pending = [rootPid]
  const seen = new Set()

  while (pending.length > 0) {
    const pid = pending.pop()
    if (!Number.isInteger(pid) || seen.has(pid)) continue
    seen.add(pid)

    const node = nodes.get(pid)
    if (node) {
      totalKb += node.rssKb
    }

    for (const [candidatePid, candidateNode] of nodes.entries()) {
      if (candidateNode.ppid === pid && !seen.has(candidatePid)) {
        pending.push(candidatePid)
      }
    }
  }

  return totalKb > 0 ? totalKb * 1024 : null
}

export async function getProcessTreeMemoryBytes(rootPid, options = {}) {
  if (!Number.isInteger(rootPid) || rootPid <= 0) return null
  if (process.platform === 'win32') return null

  const spawn = options.spawn ?? defaultSpawn

  return new Promise((resolve) => {
    let inspector
    try {
      inspector = spawn('ps', ['-axo', 'pid=,ppid=,rss='], {
        stdio: ['ignore', 'pipe', 'ignore'],
      })
    } catch {
      resolve(null)
      return
    }

    let output = ''
    inspector.stdout?.setEncoding('utf8')
    inspector.stdout?.on('data', (chunk) => {
      output += chunk
    })

    inspector.on('error', () => resolve(null))
    inspector.on('close', (code) => {
      if ((code ?? 1) !== 0) {
        resolve(null)
        return
      }

      resolve(parseProcessTreeMemoryBytes(output, rootPid))
    })
  })
}
