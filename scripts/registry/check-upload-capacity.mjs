import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveNodeBundledCli } from '../lib/spawn-cli.mjs'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

export function readUploadCapacity(config) {
  const matches = [...config.matchAll(/^max_body_size:\s*(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)\s*$/gm)]
  if (matches.length !== 1) throw new Error('Expected one finite max_body_size with a byte unit')
  const [, amount, unit] = matches[0]
  const capacity = Number(amount) * 1024 ** ['b', 'kb', 'mb', 'gb'].indexOf(unit)
  if (!Number.isSafeInteger(capacity) || capacity <= 0) throw new Error('Invalid upload capacity')
  return capacity
}

export function assertUploadFits(requestBytes, capacityBytes) {
  if (!Number.isSafeInteger(requestBytes) || requestBytes <= 0) throw new Error('Missing npm publish body')
  if (requestBytes > capacityBytes) {
    throw new Error(`npm publish body ${requestBytes} bytes exceeds max_body_size ${capacityBytes} bytes`)
  }
}

export async function measurePublishBody(tarballPath) {
  const npm = resolveNodeBundledCli('npm')
  if (!npm) throw new Error('Could not resolve the npm CLI')
  const tempDir = mkdtempSync(join(tmpdir(), 'om-upload-capacity-'))
  let requestBytes = 0
  const server = createServer((request, response) => {
    if (request.method !== 'PUT') {
      response.writeHead(404).end()
      return
    }
    request.on('data', (chunk) => { requestBytes += chunk.length })
    request.on('end', () => {
      response.writeHead(201, { 'content-type': 'application/json' }).end('{"ok":true}')
    })
  })
  try {
    await new Promise((resolveListen, rejectListen) => {
      server.once('error', rejectListen)
      server.listen(0, '127.0.0.1', resolveListen)
    })
    const registryUrl = `http://127.0.0.1:${server.address().port}`
    const npmrcPath = join(tempDir, '.npmrc')
    writeFileSync(npmrcPath, `//127.0.0.1:${server.address().port}/:_auth=fake-local-capacity-probe\n`)
    await new Promise((resolvePublish, rejectPublish) => {
      const child = spawn(npm.command, [...npm.prefixArgs, 'publish', resolve(tarballPath),
        '--registry', registryUrl, `--@open-mercato:registry=${registryUrl}`,
        '--ignore-scripts', '--provenance=false', '--access', 'public', '--fetch-retries', '0',
        '--userconfig', npmrcPath, '--cache', join(tempDir, 'cache')], {
        cwd: tempDir,
        env: { ...process.env, NPM_CONFIG_USERCONFIG: npmrcPath, NPM_CONFIG_CACHE: join(tempDir, 'cache') },
        stdio: ['ignore', 'ignore', 'pipe'],
        timeout: 60_000,
      })
      let diagnostic = ''
      child.stderr.on('data', (chunk) => { diagnostic = (diagnostic + chunk.toString()).slice(-4096) })
      child.once('error', rejectPublish)
      child.once('close', (code) => code === 0
        ? resolvePublish()
        : rejectPublish(new Error(`npm upload probe failed (exit ${code}): ${diagnostic}`)))
    })
    if (requestBytes === 0) throw new Error('Missing npm publish body')
    return requestBytes
  } finally {
    server.closeAllConnections()
    await new Promise((resolveClose) => server.close(resolveClose))
    rmSync(tempDir, { recursive: true, force: true })
  }
}

async function main(tarballPaths) {
  if (tarballPaths.length === 0) throw new Error('Usage: node scripts/registry/check-upload-capacity.mjs <package.tgz> [...]')
  const capacityBytes = readUploadCapacity(readFileSync(join(rootDir, 'config/verdaccio/config.yaml'), 'utf8'))
  for (const tarballPath of tarballPaths) {
    const tarballBytes = statSync(tarballPath).size
    const requestBytes = await measurePublishBody(tarballPath)
    console.log(JSON.stringify({ tarballPath, tarballBytes, requestBytes, capacityBytes,
      headroomBytes: capacityBytes - requestBytes }))
    assertUploadFits(requestBytes, capacityBytes)
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
