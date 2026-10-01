import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ALLOWED_LOGINS,
  evaluate,
  formatSummaryMarkdown,
  isAllowedLogin,
  type CommitInfo,
  type PrAuthor,
} from '../ci/enterprise-contribution-guard.ts'

function fakeDeps({ files, commits, commitFiles, prAuthor = { login: 'pkarw', type: 'User' } }: {
  files: string[]
  commits: CommitInfo[]
  commitFiles: Record<string, string[]>
  prAuthor?: PrAuthor
}) {
  return {
    prAuthor,
    listFiles: async () => files,
    listCommits: async () => commits,
    getCommitFiles: async (sha: string) => commitFiles[sha] || [],
    allowedLogins: ALLOWED_LOGINS,
  }
}

test('isAllowedLogin is case-insensitive and rejects non-string logins', () => {
  assert.equal(isAllowedLogin('PKarw', ALLOWED_LOGINS), true)
  assert.equal(isAllowedLogin('pkarw', ALLOWED_LOGINS), true)
  assert.equal(isAllowedLogin('octocat', ALLOWED_LOGINS), false)
  assert.equal(isAllowedLogin(null, ALLOWED_LOGINS), false)
  assert.equal(isAllowedLogin(undefined, ALLOWED_LOGINS), false)
})

test('passes a PR that never touches packages/enterprise/', async () => {
  const result = await evaluate(fakeDeps({
    files: ['packages/core/src/modules/customers/index.ts'],
    commits: [{ sha: 'a1', authorLogin: 'octocat', authorType: 'User', authorEmail: null }],
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
  // pkarw opens the PR; octocat pushes a follow-up commit touching enterprise/.
  const result = await evaluate(fakeDeps({
    files: ['packages/enterprise/src/modules/sso/index.ts'],
    commits: [
      { sha: 'a1', authorLogin: 'pkarw', authorType: 'User', authorEmail: null },
      { sha: 'a2', authorLogin: 'octocat', authorType: 'User', authorEmail: null },
    ],
    commitFiles: {
      a1: ['packages/core/src/modules/customers/index.ts'],
      a2: ['packages/enterprise/src/modules/sso/index.ts'],
    },
  }))
  assert.equal(result.touchesEnterprise, true)
  assert.equal(result.violations.length, 1)
  assert.equal(result.violations[0].sha, 'a2')
  assert.equal(result.violations[0].identity, '@octocat')
  assert.deepEqual(result.violations[0].files, ['packages/enterprise/src/modules/sso/index.ts'])
})

test('fails when a non-allowlisted opener spoofs an allowlisted commit author', async () => {
  const result = await evaluate(fakeDeps({
    prAuthor: { login: 'octocat', type: 'User' },
    files: ['packages/enterprise/src/modules/sso/index.ts'],
    commits: [{ sha: 'a1', authorLogin: 'pkarw', authorType: 'User', authorEmail: null }],
    commitFiles: { a1: ['packages/enterprise/src/modules/sso/index.ts'] },
  }))
  assert.equal(result.prAuthorViolation, '@octocat')
  assert.deepEqual(result.violations, [])
})

test('fails when a non-allowlisted opener spoofs a bot commit author', async () => {
  const result = await evaluate(fakeDeps({
    prAuthor: { login: 'octocat', type: 'User' },
    files: ['packages/enterprise/package.json'],
    commits: [{ sha: 'a1', authorLogin: 'dependabot[bot]', authorType: 'Bot', authorEmail: null }],
    commitFiles: { a1: ['packages/enterprise/package.json'] },
  }))
  assert.equal(result.prAuthorViolation, '@octocat')
})

test('does not check the opener when the PR never touches packages/enterprise/', async () => {
  const result = await evaluate(fakeDeps({
    prAuthor: { login: 'octocat', type: 'User' },
    files: ['packages/core/src/modules/customers/index.ts'],
    commits: [],
    commitFiles: {},
  }))
  assert.equal(result.prAuthorViolation, null)
})

test('skips bot commits even when they touch packages/enterprise/', async () => {
  const result = await evaluate(fakeDeps({
    files: ['packages/enterprise/package.json'],
    prAuthor: { login: 'dependabot[bot]', type: 'Bot' },
    commits: [{ sha: 'a1', authorLogin: 'dependabot[bot]', authorType: 'Bot', authorEmail: null }],
    commitFiles: { a1: ['packages/enterprise/package.json'] },
  }))
  assert.equal(result.prAuthorViolation, null)
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
    commits: [{ sha: 'a1', authorLogin: 'octocat', authorType: 'User', authorEmail: null }],
    commitFiles: { a1: ['packages/core/src/modules/customers/index.ts'] },
  }))
  assert.deepEqual(result.violations, [])
})

test('formatSummaryMarkdown lists every violation with a short sha and its files', () => {
  const markdown = formatSummaryMarkdown([
    { sha: 'abcdef1234567', identity: '@octocat', files: ['packages/enterprise/a.ts', 'packages/enterprise/b.ts'] },
  ])
  assert.match(markdown, /abcdef1 by @octocat/)
  assert.match(markdown, /`packages\/enterprise\/a\.ts`, `packages\/enterprise\/b\.ts`/)
  assert.match(markdown, /CONTRIBUTING\.md/)
  assert.doesNotMatch(markdown, /opened by/)
})

test('formatSummaryMarkdown names a non-allowlisted PR opener', () => {
  const markdown = formatSummaryMarkdown([], '@octocat')
  assert.match(markdown, /opened by @octocat/)
  assert.doesNotMatch(markdown, /need to be dropped/)
})
