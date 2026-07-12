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
}

for (const relPath of COMPOSE_FILES) {
  test(`${relPath} wires the Documents collaboration sidecar`, () => {
    const content = readCompose(relPath)
    assert.match(content, /documents-collab:/)
    assert.match(content, /command:\s*\["yarn", "documents:collab"\]/)
    assert.match(content, /DOCUMENTS_COLLAB_REDIS_URL:/)
    assert.match(content, /DOCUMENTS_COLLAB_APP_ROOT:/)
  })
}

for (const relPath of [
  'docker-compose.fullapp.yml',
  'packages/create-app/template/docker-compose.fullapp.yml',
]) {
  test(`${relPath} derives collaboration origins only from an explicit public app URL`, () => {
    const content = readCompose(relPath)
    assert.match(content, /APP_URL:\s*\$\{APP_URL:\?Set APP_URL to the public application origin\}/)
    assert.match(
      content,
      /DOCUMENTS_COLLAB_ALLOWED_ORIGINS:\s*\$\{DOCUMENTS_COLLAB_ALLOWED_ORIGINS:-\$\{APP_URL\}\}/,
    )
    assert.doesNotMatch(content, /DOCUMENTS_COLLAB_ALLOWED_ORIGINS[^\n]*localhost/)
  })
}
