/** @jest-environment node */
import path from 'path'
import {
  sanitizeStorageRelativePath,
  resolveContainedPath,
  resolveLegacyPublicRoot,
} from '@open-mercato/core/modules/attachments/lib/pathContainment'

describe('sanitizeStorageRelativePath', () => {
  it('drops leading slashes, empty, "." and ".." segments', () => {
    expect(sanitizeStorageRelativePath('/org_a/tenant_b/file.txt')).toBe(
      path.join('org_a', 'tenant_b', 'file.txt'),
    )
    expect(sanitizeStorageRelativePath('a/./b/../c')).toBe(path.join('a', 'b', 'c'))
    expect(sanitizeStorageRelativePath('..')).toBe('')
    expect(sanitizeStorageRelativePath('../..')).toBe('')
    expect(sanitizeStorageRelativePath('..\\..')).toBe('')
  })
})

describe('resolveContainedPath — containment within a single root', () => {
  const root = path.resolve('/srv/storage/attachments/main')

  function stays(input: string): boolean {
    const resolved = resolveContainedPath(root, input)
    const rel = path.relative(root, resolved)
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
  }

  it('keeps a bare ".." inside the root (regression for issue 1)', () => {
    expect(stays('..')).toBe(true)
    expect(stays('../..')).toBe(true)
    expect(stays('..\\..')).toBe(true)
  })

  it('resolves a legitimate scoped path under the root', () => {
    expect(resolveContainedPath(root, 'org_a/tenant_b/file.txt')).toBe(
      path.join(root, 'org_a', 'tenant_b', 'file.txt'),
    )
  })

  it('contains paths that try to climb out via traversal', () => {
    expect(resolveContainedPath(root, 'org_a/../../../../etc/passwd')).toBe(
      path.join(root, 'org_a', 'etc', 'passwd'),
    )
    expect(stays('org_a/../../../../etc/passwd')).toBe(true)
  })
})

describe('resolveContainedPath — legacyPublic sub-root containment (issue 2)', () => {
  const publicRoot = resolveLegacyPublicRoot()

  it('resolves legitimate public-prefixed paths under public/', () => {
    expect(resolveContainedPath(process.cwd(), 'public/uploads/img.png', publicRoot)).toBe(
      path.join(process.cwd(), 'public', 'uploads', 'img.png'),
    )
    expect(resolveContainedPath(process.cwd(), '/public/img.png', publicRoot)).toBe(
      path.join(process.cwd(), 'public', 'img.png'),
    )
  })

  it('rejects paths that resolve outside public/ even without "../"', () => {
    expect(() => resolveContainedPath(process.cwd(), '.env', publicRoot)).toThrow()
    expect(() => resolveContainedPath(process.cwd(), 'config/secrets.json', publicRoot)).toThrow()
  })

  it('rejects traversal that escapes public/', () => {
    expect(() => resolveContainedPath(process.cwd(), '../../etc/passwd', publicRoot)).toThrow()
  })
})
