import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

/**
 * The dev collaboration sidecar runs `packages/documents/dist/server/documents-collab-server.js`
 * out of the shared `pkg_documents_dist` named volume. A named volume mounted by the sidecar
 * alone MASKS the bind-mounted host dist and is never populated, so the sidecar restart-loops on
 * a missing entry file. Three things must therefore agree:
 *
 *   1. the app service mounts the volume (it owns the build that fills it),
 *   2. the dev image ships the package under /opt/prebuilt/dist, and
 *   3. the dev entrypoint seeds that package into the empty volume.
 *
 * The create-app template deliberately has no such volume: its sidecar resolves the server from
 * `node_modules/@open-mercato/documents`, so it is intentionally excluded here.
 */
const DEV_COMPOSE = 'docker-compose.fullapp.dev.yml'
const DEV_ENTRYPOINT = 'docker/scripts/dev-entrypoint.sh'
const DOCKERFILE = 'Dockerfile'
const VOLUME_MOUNT = 'pkg_documents_dist:/app/packages/documents/dist'

function read(relPath) {
  return fs.readFileSync(path.resolve(ROOT, relPath), 'utf8')
}

function serviceBlock(content, serviceName) {
  const start = content.indexOf(`\n  ${serviceName}:`)
  assert.ok(start >= 0, `${DEV_COMPOSE} must define a ${serviceName} service`)
  const rest = content.slice(start + 1)
  const nextService = rest.search(/\n {2}[a-z0-9_-]+:\n/)
  return nextService > 0 ? rest.slice(0, nextService) : rest
}

test('the app service mounts the documents dist volume the sidecar reads from', () => {
  const content = read(DEV_COMPOSE)
  const app = serviceBlock(content, 'app')
  assert.ok(
    app.includes(VOLUME_MOUNT),
    `${DEV_COMPOSE} app service must mount ${VOLUME_MOUNT}; without it the volume masks the host dist for the sidecar and nothing populates it`,
  )
})

test('the documents-collab sidecar mounts the same documents dist volume', () => {
  const content = read(DEV_COMPOSE)
  const sidecar = serviceBlock(content, 'documents-collab')
  assert.ok(
    sidecar.includes(VOLUME_MOUNT),
    `${DEV_COMPOSE} documents-collab service must mount ${VOLUME_MOUNT}`,
  )
})

test('the documents dist volume is declared in the top-level volumes block', () => {
  const content = read(DEV_COMPOSE)
  assert.match(
    content,
    /^ {2}pkg_documents_dist:/m,
    `${DEV_COMPOSE} must declare pkg_documents_dist in its volumes block`,
  )
})

test('the dev image ships documents dist under /opt/prebuilt for volume seeding', () => {
  const content = read(DOCKERFILE)
  assert.ok(
    content.includes('/app/packages/documents/dist /opt/prebuilt/dist/documents'),
    `${DOCKERFILE} must copy packages/documents/dist into /opt/prebuilt/dist/documents so the dev entrypoint can seed the empty volume`,
  )
})

test('the dev entrypoint seeds the documents package into an empty dist volume', () => {
  const content = read(DEV_ENTRYPOINT)
  const seedLoop = content.split('\n').find((line) => line.includes('for pkg in '))
  assert.ok(seedLoop, `${DEV_ENTRYPOINT} must seed prebuilt package dist directories`)
  assert.ok(
    /\bdocuments\b/.test(seedLoop),
    `${DEV_ENTRYPOINT} seed loop must include documents; otherwise pkg_documents_dist stays empty and the sidecar restart-loops`,
  )
})
