import { checkExampleExists, parseExampleUrl } from '../example.js'

describe('parseExampleUrl', () => {
  describe('plain name resolution', () => {
    it('resolves plain name to official repo', () => {
      const result = parseExampleUrl('prm')
      expect(result).toEqual({
        owner: 'open-mercato',
        repo: 'ready-apps',
        branch: 'main',
        filePath: 'apps/prm',
      })
    })

    it('resolves hyphenated name', () => {
      const result = parseExampleUrl('field-service')
      expect(result).toEqual({
        owner: 'open-mercato',
        repo: 'ready-apps',
        branch: 'main',
        filePath: 'apps/field-service',
      })
    })
  })

  describe('GitHub URL resolution', () => {
    it('parses full URL with tree/branch/path', () => {
      const result = parseExampleUrl('https://github.com/some-agency/their-app/tree/main/examples/custom')
      expect(result).toEqual({
        owner: 'some-agency',
        repo: 'their-app',
        branch: 'main',
        filePath: 'examples/custom',
      })
    })

    it('parses URL with branch only (no path)', () => {
      const result = parseExampleUrl('https://github.com/some-agency/their-app/tree/develop')
      expect(result).toEqual({
        owner: 'some-agency',
        repo: 'their-app',
        branch: 'develop',
        filePath: '',
      })
    })

    it('parses URL without tree (repo root)', () => {
      const result = parseExampleUrl('https://github.com/some-agency/their-app')
      expect(result).toEqual({
        owner: 'some-agency',
        repo: 'their-app',
        branch: 'main',
        filePath: '',
      })
    })

    it('handles http:// URLs', () => {
      const result = parseExampleUrl('http://github.com/owner/repo')
      expect(result).toEqual({
        owner: 'owner',
        repo: 'repo',
        branch: 'main',
        filePath: '',
      })
    })
  })

  describe('error cases', () => {
    it('rejects invalid GitHub URL (no repo)', () => {
      expect(() => parseExampleUrl('https://github.com/owner')).toThrow('Invalid GitHub URL')
    })

    it('rejects GitHub URL with non-tree path', () => {
      expect(() => parseExampleUrl('https://github.com/owner/repo/blob/main/file.ts')).toThrow('Invalid GitHub URL')
    })

    it('rejects non-GitHub URL', () => {
      expect(() => parseExampleUrl('https://gitlab.com/owner/repo')).toThrow('Invalid app')
    })

    it('rejects names with uppercase', () => {
      expect(() => parseExampleUrl('MyApp')).toThrow('Invalid app')
    })

    it('rejects names with special characters', () => {
      expect(() => parseExampleUrl('my_app')).toThrow('Invalid app')
    })
  })

  describe('branch override', () => {
    it('overrides branch for plain name', () => {
      const result = parseExampleUrl('prm', { branch: 'feat/prm-phase1' })
      expect(result).toEqual({
        owner: 'open-mercato',
        repo: 'ready-apps',
        branch: 'feat/prm-phase1',
        filePath: 'apps/prm',
      })
    })

    it('overrides branch for GitHub URL and skips branch segments in path', () => {
      const result = parseExampleUrl(
        'https://github.com/some-agency/their-app/tree/feat/custom/examples/app',
        { branch: 'feat/custom' }
      )
      expect(result).toEqual({
        owner: 'some-agency',
        repo: 'their-app',
        branch: 'feat/custom',
        filePath: 'examples/app',
      })
    })
  })
})

describe('checkExampleExists', () => {
  const mockInfo = { owner: 'open-mercato', repo: 'ready-apps', branch: 'main', filePath: 'examples/prm' }
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('does not throw when example exists (200)', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 })
    await expect(checkExampleExists(mockInfo)).resolves.toBeUndefined()
  })

  it('throws on 404 with descriptive message', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 404 })
    await expect(checkExampleExists(mockInfo)).rejects.toThrow('App not found')
  })

  it('throws on 403 with rate limit message', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 403 })
    await expect(checkExampleExists(mockInfo)).rejects.toThrow('rate limit')
  })

  it('throws on 401 with private repo message', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 401 })
    await expect(checkExampleExists(mockInfo)).rejects.toThrow('not accessible')
  })

  it('skips check when filePath is empty (full repo)', async () => {
    const mockFetch = jest.fn()
    global.fetch = mockFetch
    const fullRepoInfo = { ...mockInfo, filePath: '' }
    await checkExampleExists(fullRepoInfo)
    expect(mockFetch).not.toHaveBeenCalled()
  })
})
