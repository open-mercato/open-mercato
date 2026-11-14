import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const FULLAPP_COMPOSE_FILES = [
  'docker-compose.fullapp.yml',
  'packages/create-app/template/docker-compose.fullapp.yml',
]
const REDIS_COMPOSE_FILES = [
  'docker-compose.yml',
  'docker-compose.fullapp.yml',
  'docker-compose.fullapp.dev.yml',
  'packages/create-app/template/docker-compose.yml',
  'packages/create-app/template/docker-compose.fullapp.yml',
  'packages/create-app/template/docker-compose.fullapp.dev.yml',
]
const MONITORED_SERVICES = ['postgres', 'redis', 'meilisearch']
const AUTOHEAL_LABEL = 'autoheal-${DEPLOY_ENV:-local}'
const AUTOHEAL_IMAGE = 'willfarrell/autoheal:1.2.0'

function readCompose(relPath) {
  return fs.readFileSync(path.resolve(ROOT, relPath), 'utf8')
}

function readServices(content) {
  const services = new Map()
  const lines = content.split('\n')
  let inServices = false
  let current = null

  for (const line of lines) {
    if (/^services:\s*$/.test(line)) {
      inServices = true
      continue
    }
    if (!inServices) continue
    if (/^[A-Za-z]/.test(line)) break
    const header = /^ {2}([a-zA-Z][a-zA-Z0-9_-]*):\s*$/.exec(line)
    if (header) {
      current = header[1]
      services.set(current, [])
      continue
    }
    if (current) services.get(current).push(line)
  }

  return services
}

function readService(content, service) {
  const services = readServices(content)
  const block = services.get(service)
  assert.ok(block, `${service} service must exist`)
  return block.join('\n')
}

for (const relPath of FULLAPP_COMPOSE_FILES) {
  const content = readCompose(relPath)

  test(`${relPath} runs a pinned autoheal sidecar scoped to this stack`, () => {
    const autoheal = readService(content, 'autoheal')

    assert.match(
      autoheal,
      new RegExp(`^\\s+image:\\s+${AUTOHEAL_IMAGE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'),
      `${relPath} must pin the autoheal image`,
    )
    assert.match(
      autoheal,
      new RegExp(`^\\s+AUTOHEAL_CONTAINER_LABEL:\\s+${AUTOHEAL_LABEL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'),
      `${relPath} must scope the label name to DEPLOY_ENV so sibling stacks are never restarted`,
    )
    assert.match(
      autoheal,
      /^\s+- \/var\/run\/docker\.sock:\/var\/run\/docker\.sock$/m,
      `${relPath} must mount the Docker socket for the sidecar`,
    )
  })

  test(`${relPath} labels every monitored service with the stack-scoped autoheal label`, () => {
    for (const service of MONITORED_SERVICES) {
      assert.match(
        readService(content, service),
        new RegExp(`^\\s+- "${AUTOHEAL_LABEL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}=true"$`, 'm'),
        `${relPath} must label ${service} with ${AUTOHEAL_LABEL}=true`,
      )
    }
  })

  test(`${relPath} gives every monitored healthcheck a start period`, () => {
    for (const service of MONITORED_SERVICES) {
      const block = readService(content, service)
      assert.match(
        block,
        /^\s+start_period:\s+\d+s$/m,
        `${relPath} must set a start_period on ${service}, or autoheal restarts it mid-recovery`,
      )
    }
  })

  test(`${relPath} keeps the autoheal curl timeout above the stop timeout`, () => {
    const autoheal = readService(content, 'autoheal')
    const stopTimeout = /^\s+AUTOHEAL_DEFAULT_STOP_TIMEOUT:\s+\$\{AUTOHEAL_DEFAULT_STOP_TIMEOUT:-(\d+)\}$/m.exec(autoheal)
    const curlTimeout = /^\s+CURL_TIMEOUT:\s+\$\{AUTOHEAL_CURL_TIMEOUT:-(\d+)\}$/m.exec(autoheal)

    assert.ok(stopTimeout, `${relPath} must default AUTOHEAL_DEFAULT_STOP_TIMEOUT`)
    assert.ok(curlTimeout, `${relPath} must default CURL_TIMEOUT`)
    assert.ok(
      Number(curlTimeout[1]) > Number(stopTimeout[1]),
      `${relPath} must keep CURL_TIMEOUT > AUTOHEAL_DEFAULT_STOP_TIMEOUT (got ${curlTimeout[1]} vs ${stopTimeout[1]})`,
    )
  })
}

test('the two fullapp compose files keep the same autoheal contract', () => {
  const [rootContent, templateContent] = FULLAPP_COMPOSE_FILES.map(readCompose)
  const rootAutoheal = readService(rootContent, 'autoheal')
  const templateAutoheal = readService(templateContent, 'autoheal')
  const environmentOf = (block) =>
    block
      .split('\n')
      .map((line) => /^\s{6}([A-Z_]+):.*$/.exec(line))
      .filter(Boolean)
      .map((match) => match[1])
      .sort()

  assert.deepEqual(
    environmentOf(templateAutoheal),
    environmentOf(rootAutoheal),
    'the create-app template must mirror the monorepo autoheal environment',
  )
})

for (const relPath of REDIS_COMPOSE_FILES) {
  test(`${relPath} restarts redis on daemon and host reboot`, () => {
    assert.match(
      readService(readCompose(relPath), 'redis'),
      /^\s+restart:\s+unless-stopped$/m,
      `${relPath} must give redis a restart policy, or it stays down after a reboot`,
    )
  })
}
