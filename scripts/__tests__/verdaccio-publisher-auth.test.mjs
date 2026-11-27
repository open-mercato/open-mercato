import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { compare } from 'bcryptjs'
import { parse } from 'yaml'
import { createLocalPublisherCredential } from '../registry/publish.mjs'

test('Verdaccio admits only the operator-provisioned first-party publisher for writes', () => {
  const config = parse(readFileSync(new URL('../../config/verdaccio/config.yaml', import.meta.url), 'utf8'))
  assert.equal(config.auth.htpasswd.max_users, -1)
  for (const pattern of ['@open-mercato/*', 'create-mercato-app']) {
    assert.deepEqual(config.packages[pattern], { access: '$all', publish: 'mercato-publisher', unpublish: 'mercato-publisher' })
  }
})

test('local bootstrap produces a fresh random credential matching the registry bcrypt verifier', async () => {
  const first = await createLocalPublisherCredential()
  const second = await createLocalPublisherCredential()
  const [username, password] = Buffer.from(first.basicAuth, 'base64').toString('utf8').split(':')
  const [storedUser, verifier] = first.htpasswd.trimEnd().split(':')
  assert.equal(username, 'mercato-publisher')
  assert.equal(storedUser, username)
  assert.match(password, /^[a-f0-9]{64}$/)
  assert.notEqual(first.basicAuth, second.basicAuth)
  assert.equal(await compare(password, verifier), true)
  assert.doesNotMatch(first.htpasswd, new RegExp(password))
})
