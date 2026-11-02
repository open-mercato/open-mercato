import { spawnSync } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'

function docker(args) {
  const result = spawnSync('docker', args, { encoding: 'utf8' })
  if (result.error) throw result.error
  return result
}

export async function startStandaloneDatabase({ run = docker, wait = delay, attempts = 60, onStarted = (database) => { void database } } = {}) {
  const created = run(['run', '--rm', '--detach',
    '--env', 'POSTGRES_USER=mercato', '--env', 'POSTGRES_PASSWORD=secret', '--env', 'POSTGRES_DB=mercato_test',
    '--publish', '127.0.0.1::5432', 'pgvector/pgvector:pg17-trixie'])
  if (created.status !== 0) throw new Error('Could not start disposable standalone database')
  const containerId = created.stdout.trim()
  if (!/^[a-f0-9]{64}$/.test(containerId)) throw new Error('Docker did not return a standalone database container id')
  let stopped = false
  const stop = () => {
    if (stopped) return
    const result = run(['rm', '--force', containerId])
    if (result.status !== 0) throw new Error(`Could not remove standalone database container ${containerId}`)
    stopped = true
  }
  try {
    onStarted({ stop })
    const published = run(['port', containerId, '5432/tcp'])
    const port = /^127\.0\.0\.1:(\d+)\s*$/.exec(published.stdout)?.[1]
    if (published.status !== 0 || !port) throw new Error('Could not resolve disposable database loopback port')
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (run(['exec', containerId, 'pg_isready', '-U', 'mercato', '-d', 'mercato_test']).status === 0) {
        return { databaseUrl: `postgres://mercato:secret@127.0.0.1:${port}/mercato_test`, stop }
      }
      await wait(1_000)
    }
    throw new Error('Disposable standalone database did not become ready')
  } catch (error) {
    stop()
    throw error
  }
}
