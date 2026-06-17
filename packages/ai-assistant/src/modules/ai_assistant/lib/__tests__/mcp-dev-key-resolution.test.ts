import { resolve } from 'node:path'
import { findProjectRoot, checkMcpConfigPermissions } from '../mcp-dev-key-resolution'

describe('mcp:dev API key resolution (#2671)', () => {
  describe('findProjectRoot', () => {
    const projectRoot = resolve('/home/dev/project')
    const launchDir = resolve('/home/dev/project/packages/ai-assistant')

    it('returns the nearest ancestor containing a root marker', () => {
      const exists = (path: string) => path === resolve(projectRoot, '.git')
      expect(findProjectRoot(launchDir, exists)).toBe(projectRoot)
    })

    it('stops at the nearest marker and never picks a marker higher up the tree', () => {
      // A marker exists both at the real project root and at a higher ancestor.
      // Walking up from the launch dir must stop at the closest one, so an
      // attacker planting a marker (and a sibling .mcp.json) higher up cannot
      // shadow the real project root.
      const higherAncestor = resolve('/home/dev')
      const exists = (path: string) =>
        path === resolve(projectRoot, '.git') || path === resolve(higherAncestor, '.git')
      expect(findProjectRoot(launchDir, exists)).toBe(projectRoot)
      expect(findProjectRoot(launchDir, exists)).not.toBe(higherAncestor)
    })

    it('falls back to the start directory (never the filesystem root) when no marker is found', () => {
      const exists = () => false
      expect(findProjectRoot(launchDir, exists)).toBe(launchDir)
      expect(findProjectRoot(launchDir, exists)).not.toBe(resolve('/'))
    })

    it('recognises any of the supported root markers', () => {
      const exists = (path: string) => path === resolve(projectRoot, 'yarn.lock')
      expect(findProjectRoot(launchDir, exists)).toBe(projectRoot)
    })
  })

  describe('checkMcpConfigPermissions', () => {
    const configPath = '/home/dev/project/.mcp.json'

    it('refuses to read a config owned by another user', () => {
      const warnings: string[] = []
      const result = checkMcpConfigPermissions(
        configPath,
        { uid: 4242, mode: 0o600 },
        1000,
        (message) => warnings.push(message),
      )
      expect(result.ok).toBe(false)
      expect(result.reason).toContain('owned by uid 4242')
      expect(warnings).toHaveLength(0)
    })

    it('warns loudly but allows when the config is group/world accessible', () => {
      const warnings: string[] = []
      const result = checkMcpConfigPermissions(
        configPath,
        { uid: 1000, mode: 0o644 },
        1000,
        (message) => warnings.push(message),
      )
      expect(result.ok).toBe(true)
      expect(warnings).toHaveLength(1)
      expect(warnings[0]).toContain('accessible to group/other')
      expect(warnings[0]).toContain('chmod 600')
    })

    it('accepts an owner-only config without warning', () => {
      const warnings: string[] = []
      const result = checkMcpConfigPermissions(
        configPath,
        { uid: 1000, mode: 0o600 },
        1000,
        (message) => warnings.push(message),
      )
      expect(result.ok).toBe(true)
      expect(warnings).toHaveLength(0)
    })

    it('skips ownership/permission checks when uid is unavailable (non-POSIX)', () => {
      const warnings: string[] = []
      const result = checkMcpConfigPermissions(
        configPath,
        { uid: 4242, mode: 0o644 },
        null,
        (message) => warnings.push(message),
      )
      expect(result.ok).toBe(true)
      expect(warnings).toHaveLength(0)
    })
  })
})
