import { execFileSync } from 'node:child_process'
import { resolveGithubModuleTarget } from '../module-github'

jest.mock('node:child_process', () => ({ execFileSync: jest.fn() }))
const execute = jest.mocked(execFileSync)
const sha = 'a'.repeat(40)

function mockGithub(manifest: unknown = { name: '@pkarw/consents' }): void {
  execute.mockImplementation((_command, args) => {
    const endpoint = args?.[1]
    const value = endpoint === 'user' ? { login: 'pkarw' }
      : typeof endpoint === 'string' && endpoint.includes('/commits/') ? { sha }
        : typeof endpoint === 'string' && endpoint.includes('/contents/') ? { encoding: 'base64', content: Buffer.from(JSON.stringify(manifest)).toString('base64') }
          : typeof endpoint === 'string' && endpoint.includes('/git/trees/') ? { tree: [{ path: 'src/modules/marketing_consents/index.ts' }] }
            : { default_branch: 'main' }
    return JSON.stringify(value)
  })
}

beforeEach(() => execute.mockReset())

test.each([
  'pkarw/consents', 'github:pkarw/consents', 'https://github.com/pkarw/consents.git/',
  'git@github.com:pkarw/consents.git', 'ssh://git@github.com/pkarw/consents.git',
  'git+https://github.com/pkarw/consents', 'github:consents',
  'git+ssh://git@github.com/pkarw/consents.git', 'http://github.com/pkarw/consents',
  'https://github.com/https://github.com/pkarw/consents', 'github.com/pkarw/consents',
])('pins GitHub locator %s to one revision', (locator) => {
  mockGithub()
  expect(resolveGithubModuleTarget(locator, '/app')).toEqual({
    packageName: '@pkarw/consents', packageSpec: `@pkarw/consents@github:pkarw/consents#${sha}`,
    locator: 'github:pkarw/consents', moduleIds: ['marketing_consents'],
  })
  expect(execute).toHaveBeenCalledWith('gh', ['api', `repos/pkarw/consents/contents/package.json?ref=${sha}`], expect.objectContaining({ cwd: '/app' }))
})

test('resolves selected refs once and inspects the same immutable revision', () => {
  mockGithub()
  resolveGithubModuleTarget('github:pkarw/consents#release/v1', '/app')
  expect(execute).toHaveBeenCalledWith('gh', ['api', 'repos/pkarw/consents/commits/release%2Fv1'], expect.anything())
  expect(execute).toHaveBeenCalledTimes(3)
})

test.each(['https://example.com/owner/repo', 'pkarw/consents/tree/main', 'github:pkarw/consents#--bad'])('rejects invalid locator %s', (locator) => {
  mockGithub()
  expect(() => resolveGithubModuleTarget(locator, '/app')).toThrow()
  expect(execute).not.toHaveBeenCalled()
})

test('accepts a GitHub .git@ref locator', () => {
  mockGithub()
  resolveGithubModuleTarget('git+ssh://git@github.com/pkarw/consents.git@release/v1', '/app')
  expect(execute).toHaveBeenCalledWith('gh', ['api', 'repos/pkarw/consents/commits/release%2Fv1'], expect.anything())
})

test('rejects malformed manifest package identities', () => {
  mockGithub({ name: '--bad' })
  expect(() => resolveGithubModuleTarget('pkarw/consents', '/app')).toThrow('valid npm package name')
})

test('reports authentication and repository errors without leaking command stderr', () => {
  execute.mockImplementation(() => { throw new Error('private token stderr') })
  expect(() => resolveGithubModuleTarget('pkarw/consents', '/app')).toThrow('gh auth login')
  expect(() => resolveGithubModuleTarget('pkarw/consents', '/app')).not.toThrow('private token')
})
