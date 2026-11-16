import assert from 'node:assert/strict'
import test from 'node:test'

import { WITHOUT_DOCKER_GUIDE_URL, isDockerCliAvailable, missingDockerNotice } from './docker-availability.js'

test('isDockerCliAvailable is false when the docker binary is missing or fails', () => {
  assert.equal(isDockerCliAvailable(() => ({ error: new Error('spawn docker ENOENT'), status: null })), false)
  assert.equal(isDockerCliAvailable(() => ({ status: 1 })), false)
  assert.equal(isDockerCliAvailable(() => ({ status: 0 })), true)
})

test('the missing-Docker notice links the manual setup guide', () => {
  const text = missingDockerNotice().join('\n')
  assert.match(text, /Docker was not found/)
  assert.ok(text.includes(WITHOUT_DOCKER_GUIDE_URL))
  assert.equal(WITHOUT_DOCKER_GUIDE_URL, 'https://github.com/open-mercato/open-mercato#without-docker')
})
