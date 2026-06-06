import {
  assertGitDeployReady,
  assertLocalUploadSafe,
  normalizeGitRepository,
  resolveRailwaySource,
} from '../source'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function runner(responses: Record<string, string | Error>) {
  return (command: string, args: string[]) => {
    const key = `${command} ${args.join(' ')}`
    const response = responses[key]
    if (response instanceof Error || response === undefined) throw response ?? new Error(key)
    return response
  }
}

describe('Railway source strategy', () => {
  it.each([
    ['git@github.com:open-mercato/example.git', 'open-mercato/example'],
    ['https://github.com/open-mercato/example.git', 'open-mercato/example'],
    ['https://gitlab.com/open-mercato/example.git', null],
  ])('normalizes supported remotes', (remote, expected) => {
    expect(normalizeGitRepository(remote)).toBe(expected)
  })

  it('prefers a synchronized GitHub remote in auto mode', () => {
    const run = runner({
      'git branch --show-current': 'main',
      'git remote get-url origin': 'git@github.com:open-mercato/example.git',
      'git rev-parse HEAD': 'abc123',
      'git status --porcelain': '',
      'git rev-parse --abbrev-ref --symbolic-full-name @{u}': 'origin/main',
      'git rev-list --count @{u}..HEAD': '0',
      'git rev-list --count HEAD..@{u}': '0',
    })

    expect(resolveRailwaySource('auto', '/tmp/app', run)).toMatchObject({
      mode: 'git',
      repo: 'open-mercato/example',
      branch: 'main',
      commitSha: 'abc123',
    })
  })

  it('falls back to local upload when no supported remote exists', () => {
    const run = runner({
      'railway --version': 'railway 4.66.1',
    })
    expect(resolveRailwaySource('auto', '/tmp/app', run)).toEqual({
      mode: 'local',
      reason: 'No usable GitHub remote found; falling back to railway up',
    })
  })

  it('falls back to local upload when Git exists but is not ready for remote deploy', () => {
    const run = runner({
      'git branch --show-current': 'main',
      'git remote get-url origin': 'git@github.com:open-mercato/example.git',
      'git rev-parse HEAD': 'abc123',
      'git status --porcelain': ' M package.json',
      'railway --version': 'railway 5.1.0',
    })
    expect(resolveRailwaySource('auto', '/tmp/app', run)).toMatchObject({
      mode: 'local',
      reason: expect.stringContaining('clean working tree'),
    })
  })

  it('rejects dirty Git-backed deploys', () => {
    const run = runner({
      'git status --porcelain': ' M package.json',
    })
    expect(() => assertGitDeployReady('/tmp/app', run)).toThrow('clean working tree')
  })

  it('rejects a Git branch that is behind its upstream', () => {
    const run = runner({
      'git status --porcelain': '',
      'git rev-parse --abbrev-ref --symbolic-full-name @{u}': 'origin/main',
      'git rev-list --count @{u}..HEAD': '0',
      'git rev-list --count HEAD..@{u}': '2',
    })
    expect(() => assertGitDeployReady('/tmp/app', run)).toThrow('behind its upstream')
  })

  it('rejects a local upload ignore file without state protection', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'mercato-railway-ignore-'))
    writeFileSync(join(cwd, '.railwayignore'), '.env\n*.pem\n*.key\n.git\nnode_modules\n')
    expect(() => assertLocalUploadSafe(cwd)).toThrow('.mercato/railway.json')
  })

  it('accepts the scaffold local upload safety contract', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'mercato-railway-ignore-'))
    writeFileSync(
      join(cwd, '.railwayignore'),
      '.env*\n*.pem\n*.key\nid_*\n.git\n.railway\nnode_modules\n.yarn/cache\n.next\n.turbo\n*.db\n*.sqlite\n*.sqlite3\n.mercato/railway.json*\n',
    )
    expect(() => assertLocalUploadSafe(cwd)).not.toThrow()
  })

  it('does not accept required safety entries from comments', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'mercato-railway-ignore-'))
    writeFileSync(
      join(cwd, '.railwayignore'),
      '# .env*\n*.pem\n*.key\nid_*\n.git\n.railway\nnode_modules\n.yarn/cache\n.next\n.turbo\n*.db\n*.sqlite\n*.sqlite3\n.mercato/railway.json*\n',
    )
    expect(() => assertLocalUploadSafe(cwd)).toThrow('.env')
  })

  it('does not treat a single env filename as protection for every env file', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'mercato-railway-ignore-'))
    writeFileSync(
      join(cwd, '.railwayignore'),
      '.env\n*.pem\n*.key\nid_*\n.git\n.railway\nnode_modules\n.yarn/cache\n.next\n.turbo\n*.db\n*.sqlite\n*.sqlite3\n.mercato/railway.json*\n',
    )
    expect(() => assertLocalUploadSafe(cwd)).toThrow('.env.*')
  })

  it('does not accept an unrelated Railway state filename prefix', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'mercato-railway-ignore-'))
    writeFileSync(
      join(cwd, '.railwayignore'),
      '.env*\n*.pem\n*.key\nid_*\n.git\n.railway\nnode_modules\n.yarn/cache\n.next\n.turbo\n*.db\n*.sqlite\n*.sqlite3\n.mercato/railway.json.example\n',
    )
    expect(() => assertLocalUploadSafe(cwd)).toThrow('.mercato/railway.json')
  })
})
