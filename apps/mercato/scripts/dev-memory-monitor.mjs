import fs from 'node:fs'
import { spawn as defaultSpawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

function resolveMemorySamplerImport() {
  const candidates = [
    new URL('./dev-memory-sampler.mjs', import.meta.url),
    new URL('../../../scripts/dev-memory-sampler.mjs', import.meta.url),
  ]

  for (const candidate of candidates) {
    if (fs.existsSync(fileURLToPath(candidate))) {
      return candidate.href
    }
  }

  throw new Error('Unable to resolve dev memory sampler module')
}

const {
  parsePsOutput,
  sampleProcessTreeMemory,
  walkTree,
} = await import(resolveMemorySamplerImport())

export function parseProcessTreeMemoryBytes(output, rootPid) {
  const tree = walkTree(parsePsOutput(output), rootPid)
  if (tree.length === 0) return null
  const totalKb = tree.reduce((acc, node) => acc + node.rssKb, 0)
  return totalKb > 0 ? totalKb * 1024 : null
}

async function getProcessTreeMemoryBytesWithSpawn(rootPid, spawn) {
  if (!Number.isInteger(rootPid) || rootPid <= 0) return null
  if (process.platform === 'win32') return null

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

export async function getProcessTreeMemorySample(rootPid, options = {}) {
  if (!Number.isInteger(rootPid) || rootPid <= 0) return null
  if (process.platform === 'win32') return null

  if (options.spawn) {
    const bytes = await getProcessTreeMemoryBytesWithSpawn(rootPid, options.spawn)
    if (!bytes) return null
    return {
      timestamp: new Date().toISOString(),
      totalRssBytes: bytes,
      totalRssMb: Math.round((bytes / 1024 / 1024) * 100) / 100,
      processCount: null,
      processClassTotals: {},
      dominantProcessClass: null,
      topProcesses: [],
      processes: [],
      cgroup: null,
    }
  }

  return sampleProcessTreeMemory(rootPid, options)
}

export async function getProcessTreeMemoryBytes(rootPid, options = {}) {
  const sample = await getProcessTreeMemorySample(rootPid, options.spawn ? { spawn: options.spawn } : options)
  return sample?.totalRssBytes ?? null
}
