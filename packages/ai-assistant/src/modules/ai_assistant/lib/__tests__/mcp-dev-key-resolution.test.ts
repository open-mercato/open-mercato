import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import * as fsPromises from 'node:fs/promises'
import {
  findProjectRoot,
  checkMcpConfigPermissions,
  getApiKeyFromMcpJson,
} from '../mcp-dev-key-resolution'

jest.mock('node:fs/promises', () => {
  const actual = jest.requireActual<typeof import('node:fs/promises')>('node:fs/promises')
  return {
    ...actual,
    lstat: jest.fn(actual.lstat),
    open: jest.fn(actual.open),
    stat: jest.fn(actual.stat),
  }
})

const realFs = jest.requireActual<typeof import('node:fs/promises')>('node:fs/promises')
const mockedLstat = jest.mocked(fsPromises.lstat)
const mockedOpen = jest.mocked(fsPromises.open)
const mockedStat = jest.mocked(fsPromises.stat)

function mcpConfig(apiKey: string): string {
  return JSON.stringify({
    mcpServers: {
      'open-mercato': {
        headers: { 'x-api-key': apiKey },
      },
    },
  })
}

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

    it('refuses a config that is group/world accessible', () => {
      const warnings: string[] = []
      const result = checkMcpConfigPermissions(
        configPath,
        { uid: 1000, mode: 0o644 },
        1000,
        (message) => warnings.push(message),
      )
      expect(result.ok).toBe(false)
      expect(result.reason).toContain('accessible to group/other')
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

  describe('getApiKeyFromMcpJson', () => {
    let projectRoot: string
    let configPath: string
    const originalEnvKey = process.env.OPEN_MERCATO_API_KEY

    beforeEach(async () => {
      projectRoot = await realFs.mkdtemp(join(tmpdir(), 'om-mcp-key-'))
      configPath = join(projectRoot, '.mcp.json')
      await realFs.mkdir(join(projectRoot, '.git'))
      jest.spyOn(process, 'cwd').mockReturnValue(projectRoot)
      delete process.env.OPEN_MERCATO_API_KEY
      mockedLstat.mockImplementation(realFs.lstat)
      mockedOpen.mockImplementation(realFs.open)
      mockedStat.mockImplementation(realFs.stat)
    })

    afterEach(async () => {
      jest.restoreAllMocks()
      mockedLstat.mockReset()
      mockedOpen.mockReset()
      mockedStat.mockReset()
      if (originalEnvKey === undefined) delete process.env.OPEN_MERCATO_API_KEY
      else process.env.OPEN_MERCATO_API_KEY = originalEnvKey
      await realFs.rm(projectRoot, { recursive: true, force: true })
    })

    it('keeps environment-key precedence without reading the config file', async () => {
      process.env.OPEN_MERCATO_API_KEY = ' env-key '

      await expect(getApiKeyFromMcpJson()).resolves.toBe('env-key')
      expect(mockedOpen).not.toHaveBeenCalled()
      expect(mockedStat).not.toHaveBeenCalled()
    })

    it('reads a valid owner-only config', async () => {
      await realFs.writeFile(configPath, mcpConfig('file-key'), { mode: 0o600 })

      await expect(getApiKeyFromMcpJson()).resolves.toBe('file-key')
    })

    it('rejects a symbolic-link config', async () => {
      if (process.platform === 'win32') return
      const targetPath = join(projectRoot, 'target.mcp.json')
      await realFs.writeFile(targetPath, mcpConfig('symlink-key'), { mode: 0o600 })
      await realFs.symlink(targetPath, configPath)

      await expect(getApiKeyFromMcpJson()).resolves.toBeUndefined()
    })

    it.each(['linux', 'win32'] as const)(
      'fails closed when the config path is replaced after open/validation (%s)',
      async (platform) => {
        const replacementPath = join(projectRoot, 'replacement.mcp.json')
        const openedPath = join(projectRoot, 'opened.mcp.json')
        await realFs.writeFile(configPath, mcpConfig('trusted-key'), { mode: 0o600 })
        await realFs.writeFile(replacementPath, mcpConfig('replacement-key'), { mode: 0o600 })
        const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')
        Object.defineProperty(process, 'platform', { ...platformDescriptor, value: platform })

        try {
          let replaced = false
          const replaceConfigPath = async () => {
            if (replaced) return
            replaced = true
            await realFs.rename(configPath, openedPath)
            await realFs.rename(replacementPath, configPath)
          }
          mockedStat.mockImplementation(async (...args) => {
            const result = await realFs.stat(...args)
            if (String(args[0]) === configPath) await replaceConfigPath()
            return result
          })
          mockedOpen.mockImplementation(async (...args) => {
            const handle = await realFs.open(...args)
            if (String(args[0]) === configPath) await replaceConfigPath()
            return handle
          })

          await expect(getApiKeyFromMcpJson()).resolves.toBeUndefined()
          expect(replaced).toBe(true)
        } finally {
          if (platformDescriptor) Object.defineProperty(process, 'platform', platformDescriptor)
        }
      },
    )

    it('reads from the validated descriptor if the path changes after validation', async () => {
      const replacementPath = join(projectRoot, 'replacement.mcp.json')
      const openedPath = join(projectRoot, 'opened.mcp.json')
      await realFs.writeFile(configPath, mcpConfig('trusted-key'), { mode: 0o600 })
      await realFs.writeFile(replacementPath, mcpConfig('replacement-key'), { mode: 0o600 })

      let replaced = false
      mockedLstat.mockImplementation(async (...args) => {
        const validatedPathStat = await realFs.lstat(...args)
        if (String(args[0]) === configPath) {
          await realFs.rename(configPath, openedPath)
          await realFs.rename(replacementPath, configPath)
          replaced = true
        }
        return validatedPathStat
      })

      await expect(getApiKeyFromMcpJson()).resolves.toBe('trusted-key')
      expect(replaced).toBe(true)
    })

    it('rejects a non-regular config entry', async () => {
      await realFs.mkdir(configPath)

      await expect(getApiKeyFromMcpJson()).resolves.toBeUndefined()
    })

    it('rejects a group/world-accessible config before reading its key', async () => {
      if (typeof process.getuid !== 'function') return
      await realFs.writeFile(configPath, mcpConfig('unsafe-key'), { mode: 0o644 })
      await realFs.chmod(configPath, 0o644)

      await expect(getApiKeyFromMcpJson()).resolves.toBeUndefined()
    })
  })
})
