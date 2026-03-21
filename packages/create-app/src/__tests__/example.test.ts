import { parseExampleUrl } from '../example.js'

describe('parseExampleUrl', () => {
  describe('plain name resolution', () => {
    it('resolves plain name to official repo', () => {
      const result = parseExampleUrl('prm')
      expect(result).toEqual({
        owner: 'open-mercato',
        repo: 'ready-apps',
        branch: 'main',
        filePath: 'examples/prm',
      })
    })

    it('resolves hyphenated name', () => {
      const result = parseExampleUrl('field-service')
      expect(result).toEqual({
        owner: 'open-mercato',
        repo: 'ready-apps',
        branch: 'main',
        filePath: 'examples/field-service',
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
      expect(() => parseExampleUrl('https://gitlab.com/owner/repo')).toThrow('Invalid example')
    })

    it('rejects names with uppercase', () => {
      expect(() => parseExampleUrl('MyApp')).toThrow('Invalid example')
    })

    it('rejects names with special characters', () => {
      expect(() => parseExampleUrl('my_app')).toThrow('Invalid example')
    })
  })
})
