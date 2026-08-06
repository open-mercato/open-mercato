import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

const COMPOSE_FILES = [
  'docker-compose.fullapp.dev.yml',
  'docker-compose.fullapp.yml',
  'packages/create-app/template/docker-compose.fullapp.dev.yml',
  'packages/create-app/template/docker-compose.fullapp.yml',
]

function readCompose(relPath) {
  return fs.readFileSync(path.resolve(ROOT, relPath), 'utf8')
}

function documentsCollabBlock(content, relPath) {
  const start = content.indexOf('documents-collab:')
  const end = content.indexOf('\n  postgres:')
  assert.ok(start >= 0, `${relPath} must define a documents-collab service`)
  assert.ok(end > start, `${relPath} must define postgres after documents-collab`)
  return content.slice(start, end)
}

for (const relPath of COMPOSE_FILES) {
  test(`${relPath} forwards APP_ALLOWED_ORIGINS into the app service`, () => {
    const content = readCompose(relPath)
    assert.match(
      content,
      /APP_ALLOWED_ORIGINS:\s*\$\{APP_ALLOWED_ORIGINS:-\}/,
      `${relPath} must forward APP_ALLOWED_ORIGINS so the env-backed origin allowlist reaches the app container`
    )
  })

  test(`${relPath} forwards APP_ALLOWED_ORIGINS alongside APP_URL`, () => {
    const content = readCompose(relPath)
    assert.ok(
      content.includes('APP_URL:'),
      `${relPath} should still forward APP_URL`
    )
  })

  test(`${relPath} never uses :? required interpolation`, () => {
    // docker compose interpolates the ENTIRE file for ANY command (ps, config,
    // logs, ...) regardless of profiles or targeted services, so a single :?
    // breaks every compose invocation for users without the variable set.
    // Optional features must degrade via :- defaults instead.
    const content = readCompose(relPath)
    assert.doesNotMatch(
      content,
      /\$\{[^}]*:\?/,
      `${relPath} must not hard-require env vars via :? interpolation`
    )
  })
}

for (const relPath of COMPOSE_FILES) {
  test(`${relPath} wires the Documents collaboration sidecar`, () => {
    const content = readCompose(relPath)
    const sidecar = documentsCollabBlock(content, relPath)
    assert.match(content, /documents-collab:/)
    assert.match(sidecar, /profiles:\s*\n\s+- documents-collab/)
    assert.match(sidecar, /command:\s*\["yarn", "documents:collab"\]/)
    assert.match(sidecar, /DOCUMENTS_COLLAB_REDIS_URL:/)
    assert.match(sidecar, /DOCUMENTS_COLLAB_REDIS_PREFIX:/)
    assert.match(sidecar, /DOCUMENTS_COLLAB_APP_ROOT:/)
  })

  test(`${relPath} mirrors app encryption and Redis env into the sidecar`, () => {
    const sidecar = documentsCollabBlock(readCompose(relPath), relPath)
    assert.match(
      sidecar,
      /TENANT_DATA_ENCRYPTION_KEY:\s*\$\{TENANT_DATA_ENCRYPTION_KEY:-\}/,
      `${relPath} documents-collab must receive TENANT_DATA_ENCRYPTION_KEY like the app service`
    )
    assert.match(
      sidecar,
      /TENANT_DATA_ENCRYPTION_DEBUG:\s*\$\{TENANT_DATA_ENCRYPTION_DEBUG:-false\}/,
      `${relPath} documents-collab must receive TENANT_DATA_ENCRYPTION_DEBUG like the app service`
    )
    assert.match(
      sidecar,
      /^\s+REDIS_URL:\s*redis:\/\//m,
      `${relPath} documents-collab must receive REDIS_URL for multi-instance collaboration sync`
    )
  })
}

for (const relPath of [
  'docker-compose.fullapp.yml',
  'packages/create-app/template/docker-compose.fullapp.yml',
]) {
  test(`${relPath} derives collaboration origins only from an explicit public app URL`, () => {
    const content = readCompose(relPath)
    assert.match(content, /APP_URL:\s*\$\{APP_URL:-http:\/\/localhost:3000\}/)
    assert.match(
      content,
      /DOCUMENTS_COLLAB_ALLOWED_ORIGINS:\s*\$\{DOCUMENTS_COLLAB_ALLOWED_ORIGINS:-\$\{APP_URL\}\}/,
    )
    assert.doesNotMatch(content, /DOCUMENTS_COLLAB_ALLOWED_ORIGINS[^\n]*localhost/)
  })

  test(`${relPath} keeps the Documents collab vars optional with empty defaults`, () => {
    const content = readCompose(relPath)
    assert.match(
      content,
      /NEXT_PUBLIC_DOCUMENTS_COLLAB_URL:\s*\$\{NEXT_PUBLIC_DOCUMENTS_COLLAB_URL:-\}/,
    )
    assert.doesNotMatch(content, /NEXT_PUBLIC_DOCUMENTS_COLLAB_URL[^\n]*:-ws:\/\/localhost/)
    assert.match(
      content,
      /DOCUMENTS_COLLAB_JWT_SECRET_V2:\s*\$\{DOCUMENTS_COLLAB_JWT_SECRET_V2:-\}/,
    )
    assert.doesNotMatch(content, /DOCUMENTS_COLLAB_JWT_SECRET_V2[^\n]*:-dev-only/)
  })
}

for (const relPath of COMPOSE_FILES) {
  test(`${relPath} leaves collaboration disabled until its profile is selected`, () => {
    const content = readCompose(relPath)
    assert.match(
      content,
      /NEXT_PUBLIC_DOCUMENTS_COLLAB_URL:\s*\$\{NEXT_PUBLIC_DOCUMENTS_COLLAB_URL:-\}/,
    )
    assert.doesNotMatch(content, /NEXT_PUBLIC_DOCUMENTS_COLLAB_URL[^\n]*:-ws:\/\/localhost/)
  })
}
