import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ALLOWED_LOGINS,
  evaluate,
  formatSummaryMarkdown,
  isAllowedLogin,
} from '../ci/enterprise-contribution-guard.mjs'

function fakeDeps({ files, commits, commitFiles }) {
  return {
    listFiles: async () => files,
    listCommits: async () => commits,
    getCommitFiles: async (sha) => commitFiles[sha] || [],
    allowedLogins: ALLOWED_LOGINS,
  }
}

test('isAllowedLogin is case-insensitive and rejects non-string logins', () => {
  assert.equal(isAllowedLogin('PKarw', ALLOWED_LOGINS), true)
  assert.equal(isAllowedLogin('pkarw', ALLOWED_LOGINS), true)
  assert.equal(isAllowedLogin('bernard', ALLOWED_LOGINS), false)
  assert.equal(isAllowedLogin(null, ALLOWED_LOGINS), false)
  assert.equal(isAllowedLogin(undefined, ALLOWED_LOGINS), false)
})

test('passes a PR that never touches packages/enterprise/', async () => {
  const result = await evaluate(fakeDeps({
    files: ['packages/core/src/modules/customers/index.ts'],
    commits: [{ sha: 'a1', authorLogin: 'bernard', authorType: 'User', authorEmail: null }],
    commitFiles: {},
  }))
  assert.equal(result.touchesEnterprise, false)
  assert.deepEqual(result.violations, [])
})

test('passes when every commit touching packages/enterprise/ is by an allowlisted author', async () => {
  const result = await evaluate(fakeDeps({
    files: ['packages/enterprise/src/modules/sso/index.ts'],
    commits: [
      { sha: 'a1', authorLogin: 'pkarw', authorType: 'User', authorEmail: null },
      { sha: 'a2', authorLogin: 'matgren', authorType: 'User', authorEmail: null },
    ],
    commitFiles: {
      a1: ['packages/enterprise/src/modules/sso/index.ts'],
      a2: ['packages/core/src/modules/customers/index.ts'],
    },
  }))
  assert.equal(result.touchesEnterprise, true)
  assert.deepEqual(result.violations, [])
})

test('fails when a non-allowlisted author pushes a commit to an allowlisted author\'s PR', async () => {
  // pkarw opens the PR; bernard pushes a follow-up commit touching enterprise/.
  const result = await evaluate(fakeDeps({
    files: ['packages/enterprise/src/modules/sso/index.ts'],
    commits: [
      { sha: 'a1', authorLogin: 'pkarw', authorType: 'User', authorEmail: null },
      { sha: 'a2', authorLogin: 'bernard', authorType: 'User', authorEmail: null },
    ],
    commitFiles: {
      a1: ['packages/core/src/modules/customers/index.ts'],
      a2: ['packages/enterprise/src/modules/sso/index.ts'],
    },
  }))
  assert.equal(result.touchesEnterprise, true)
  assert.equal(result.violations.length, 1)
  assert.equal(result.violations[0].sha, 'a2')
  assert.equal(result.violations[0].identity, '@bernard')
  assert.deepEqual(result.violations[0].files, ['packages/enterprise/src/modules/sso/index.ts'])
})

test('skips bot commits even when they touch packages/enterprise/', async () => {
  const result = await evaluate(fakeDeps({
    files: ['packages/enterprise/package.json'],
    commits: [{ sha: 'a1', authorLogin: 'dependabot[bot]', authorType: 'Bot', authorEmail: null }],
    commitFiles: { a1: ['packages/enterprise/package.json'] },
  }))
  assert.deepEqual(result.violations, [])
})

test('falls back to commit email when GitHub cannot resolve a login', async () => {
  const result = await evaluate(fakeDeps({
    files: ['packages/enterprise/src/modules/sso/index.ts'],
    commits: [{ sha: 'a1', authorLogin: null, authorType: null, authorEmail: 'someone@example.com' }],
    commitFiles: { a1: ['packages/enterprise/src/modules/sso/index.ts'] },
  }))
  assert.equal(result.violations.length, 1)
  assert.equal(result.violations[0].identity, 'someone@example.com')
})

test('falls back to "unknown author" when neither login nor email is available', async () => {
  const result = await evaluate(fakeDeps({
    files: ['packages/enterprise/src/modules/sso/index.ts'],
    commits: [{ sha: 'a1', authorLogin: null, authorType: null, authorEmail: null }],
    commitFiles: { a1: ['packages/enterprise/src/modules/sso/index.ts'] },
  }))
  assert.equal(result.violations[0].identity, 'unknown author')
})

test('ignores a commit that touches unrelated files even if the overall diff touches enterprise/', async () => {
  const result = await evaluate(fakeDeps({
    files: ['packages/enterprise/src/modules/sso/index.ts', 'packages/core/src/modules/customers/index.ts'],
    commits: [{ sha: 'a1', authorLogin: 'bernard', authorType: 'User', authorEmail: null }],
    commitFiles: { a1: ['packages/core/src/modules/customers/index.ts'] },
  }))
  assert.deepEqual(result.violations, [])
})

test('formatSummaryMarkdown lists every violation with a short sha and its files', () => {
  const markdown = formatSummaryMarkdown([
    { sha: 'abcdef1234567', identity: '@bernard', files: ['packages/enterprise/a.ts', 'packages/enterprise/b.ts'] },
  ])
  assert.match(markdown, /abcdef1 by @bernard/)
  assert.match(markdown, /`packages\/enterprise\/a\.ts`, `packages\/enterprise\/b\.ts`/)
  assert.match(markdown, /CONTRIBUTING\.md/)
})
