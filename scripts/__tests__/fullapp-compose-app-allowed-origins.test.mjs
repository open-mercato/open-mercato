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
