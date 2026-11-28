import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createServer } from 'node:net'
import os from 'node:os'
import path from 'node:path'

import {
  isAppPortFree,
  readAppEnvFileValues,
  resolveAppPortPreflight,
} from '../dev-port-preflight.mjs'

function busyPorts(...ports) {
  const busy = new Set(ports)
  return async (port) => !busy.has(port)
}

test('resolveAppPortPreflight: keeps a free configured port untouched', async () => {
  const result = await resolveAppPortPreflight({ port: 3000, isFree: busyPorts() })
  assert.deepEqual(result, { status: 'free', port: 3000, envOverrides: {} })
})

test('resolveAppPortPreflight: moves to the next free port and rewrites loopback app URLs', async () => {
  const result = await resolveAppPortPreflight({
    port: 3000,
    env: {},
    appEnvFileValues: { APP_URL: 'http://localhost:3000', NEXT_PUBLIC_APP_URL: 'http://localhost:3000/' },
    isFree: busyPorts(3000, 3001),
  })
  assert.deepEqual(result, {
    status: 'moved',
    port: 3002,
    envOverrides: {
      PORT: '3002',
      APP_URL: 'http://localhost:3002',
      NEXT_PUBLIC_APP_URL: 'http://localhost:3002/',
    },
  })
})

test('resolveAppPortPreflight: sets APP_URL when the app has none configured', async () => {
  const result = await resolveAppPortPreflight({ port: 3000, isFree: busyPorts(3000) })
  assert.deepEqual(result.envOverrides, { PORT: '3001', APP_URL: 'http://localhost:3001' })
})

test('resolveAppPortPreflight: never moves a port pinned in the shell', async () => {
  for (const env of [{ PORT: '3000' }, { APP_URL: 'http://localhost:3000' }]) {
    const result = await resolveAppPortPreflight({ port: 3000, env, isFree: busyPorts(3000) })
    assert.deepEqual(result, { status: 'busy', port: 3000, envOverrides: {} })
  }
})

test('resolveAppPortPreflight: never moves a proxy-fronted public URL', async () => {
  const result = await resolveAppPortPreflight({
    port: 3000,
    appEnvFileValues: { APP_URL: 'https://dev.example.test' },
    isFree: busyPorts(3000),
  })
  assert.equal(result.status, 'busy')
})

test('resolveAppPortPreflight: reports busy when no port in the search window is free', async () => {
  const result = await resolveAppPortPreflight({ port: 3000, searchLimit: 2, isFree: async () => false })
  assert.deepEqual(result, { status: 'busy', port: 3000, envOverrides: {} })
})

test('isAppPortFree: detects a server bound to 127.0.0.1', async () => {
  const server = createServer()
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  try {
    assert.equal(await isAppPortFree(port), false)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
  assert.equal(await isAppPortFree(port), true)
})

test('readAppEnvFileValues: later env files win, missing files are skipped', () => {
  const appDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-port-preflight-'))
  try {
    fs.writeFileSync(path.join(appDir, '.env'), 'APP_URL=http://localhost:3000\nOTHER=1\n')
    fs.writeFileSync(path.join(appDir, '.env.local'), 'APP_URL=http://localhost:3100\n')
    assert.deepEqual(readAppEnvFileValues(appDir, ['APP_URL', 'NEXT_PUBLIC_APP_URL']), {
      APP_URL: 'http://localhost:3100',
    })
  } finally {
    fs.rmSync(appDir, { recursive: true, force: true })
  }
})
