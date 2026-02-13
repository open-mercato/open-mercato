import fs from 'node:fs'
import path from 'node:path'
import {
  calculateChecksum,
  readChecksumRecord,
  writeChecksumRecord,
  writeIfChanged,
  ensureDir,
  rimrafDir,
  toVar,
  toSnake,
  createGeneratorResult,
  type ChecksumRecord,
} from '../utils'

// Mock fs module
jest.mock('node:fs')

const mockFs = fs as jest.Mocked<typeof fs>

describe('utils', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('calculateChecksum', () => {
    it('returns MD5 hash of content', () => {
      const content = 'test content'
      const checksum = calculateChecksum(content)

      expect(checksum).toMatch(/^[a-f0-9]{32}$/)
    })

    it('returns same hash for same content', () => {
      const content = 'test content'

      expect(calculateChecksum(content)).toBe(calculateChecksum(content))
    })

    it('returns different hash for different content', () => {
      expect(calculateChecksum('content1')).not.toBe(calculateChecksum('content2'))
    })

    it('handles empty string', () => {
      const checksum = calculateChecksum('')

      expect(checksum).toMatch(/^[a-f0-9]{32}$/)
    })
  })

  describe('readChecksumRecord', () => {
    it('returns null when file does not exist', () => {
      mockFs.existsSync.mockReturnValue(false)

      const result = readChecksumRecord('/path/to/checksum')

      expect(result).toBeNull()
    })

    it('returns parsed record when file exists and is valid', () => {
      const record: ChecksumRecord = { content: 'abc123', structure: 'def456' }
      mockFs.existsSync.mockReturnValue(true)
      mockFs.readFileSync.mockReturnValue(JSON.stringify(record))

      const result = readChecksumRecord('/path/to/checksum')

      expect(result).toEqual(record)
    })

    it('returns null when file contains invalid JSON', () => {
      mockFs.existsSync.mockReturnValue(true)
      mockFs.readFileSync.mockReturnValue('not valid json')

      const result = readChecksumRecord('/path/to/checksum')

      expect(result).toBeNull()
    })

    it('returns null when record is missing required fields', () => {
      mockFs.existsSync.mockReturnValue(true)
      mockFs.readFileSync.mockReturnValue(JSON.stringify({ content: 'abc' }))

      const result = readChecksumRecord('/path/to/checksum')

      expect(result).toBeNull()
    })
  })

  describe('writeChecksumRecord', () => {
    it('writes JSON record with newline', () => {
      const record: ChecksumRecord = { content: 'abc123', structure: 'def456' }

      writeChecksumRecord('/path/to/checksum', record)

      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        '/path/to/checksum',
        JSON.stringify(record) + '\n'
      )
    })
  })

  describe('ensureDir', () => {
    it('creates parent directory recursively', () => {
      ensureDir('/path/to/file.txt')

      expect(mockFs.mkdirSync).toHaveBeenCalledWith('/path/to', { recursive: true })
    })
  })

  describe('rimrafDir', () => {
    it('does nothing when directory does not exist', () => {
      mockFs.existsSync.mockReturnValue(false)

      rimrafDir('/some/path/generated/test')

      expect(mockFs.readdirSync).not.toHaveBeenCalled()
    })

    it('throws error for paths outside allowed patterns', () => {
      mockFs.existsSync.mockReturnValue(true)

      expect(() => rimrafDir('/path/to/important-data')).toThrow(
        /Refusing to delete directory outside allowed paths/
      )
    })

    it('allows deletion within /generated/ pattern', () => {
      mockFs.existsSync.mockReturnValue(true)
      mockFs.readdirSync.mockReturnValue([])

      // Path must contain /generated/ (with slashes)
      expect(() => rimrafDir('/project/generated/entities')).not.toThrow()
    })

    it('allows deletion within /dist/ pattern', () => {
      mockFs.existsSync.mockReturnValue(true)
      mockFs.readdirSync.mockReturnValue([])

      expect(() => rimrafDir('/project/dist/output')).not.toThrow()
    })

    it('allows deletion within /.mercato/ pattern', () => {
      mockFs.existsSync.mockReturnValue(true)
      mockFs.readdirSync.mockReturnValue([])

      expect(() => rimrafDir('/project/.mercato/generated')).not.toThrow()
    })

    it('allows deletion within /entities/ pattern', () => {
      mockFs.existsSync.mockReturnValue(true)
      mockFs.readdirSync.mockReturnValue([])

      expect(() => rimrafDir('/project/generated/entities/test')).not.toThrow()
    })

    it('allows custom allowed patterns', () => {
      mockFs.existsSync.mockReturnValue(true)
      mockFs.readdirSync.mockReturnValue([])

      expect(() =>
        rimrafDir('/custom/temp/files', { allowedPatterns: ['/temp/'] })
      ).not.toThrow()
    })

    it('removes files and directories recursively', () => {
      mockFs.existsSync.mockReturnValue(true)
      mockFs.readdirSync.mockReturnValueOnce([
        { name: 'file.txt', isDirectory: () => false, isFile: () => true },
        { name: 'subdir', isDirectory: () => true, isFile: () => false },
      ] as any)
      mockFs.readdirSync.mockReturnValueOnce([])

      const testDir = '/project/generated/test'
      rimrafDir(testDir)

      // Use path.join to get platform-correct path separators
      expect(mockFs.unlinkSync).toHaveBeenCalledWith(path.join(testDir, 'file.txt'))
      expect(mockFs.rmdirSync).toHaveBeenCalled()
    })
  })

  describe('toVar', () => {
    it('replaces non-alphanumeric characters with underscores', () => {
      expect(toVar('hello-world')).toBe('hello_world')
      expect(toVar('foo.bar')).toBe('foo_bar')
      expect(toVar('test@123')).toBe('test_123')
    })

    it('preserves alphanumeric and underscore characters', () => {
      expect(toVar('hello_world123')).toBe('hello_world123')
    })
  })

  describe('toSnake', () => {
    it('converts camelCase to snake_case', () => {
      expect(toSnake('helloWorld')).toBe('hello_world')
      expect(toSnake('getUserById')).toBe('get_user_by_id')
    })

    it('converts PascalCase to snake_case', () => {
      expect(toSnake('HelloWorld')).toBe('hello_world')
      expect(toSnake('UserAccount')).toBe('user_account')
    })

    it('replaces non-word characters with underscores', () => {
      expect(toSnake('hello-world')).toBe('hello_world')
      expect(toSnake('foo.bar')).toBe('foo_bar')
    })

    it('removes leading and trailing underscores', () => {
      expect(toSnake('_hello_')).toBe('hello')
    })

    it('collapses multiple underscores', () => {
      expect(toSnake('hello__world')).toBe('hello_world')
    })

    it('handles simple words', () => {
      expect(toSnake('hello')).toBe('hello')
      expect(toSnake('HELLO')).toBe('hello')
    })
  })

  describe('createGeneratorResult', () => {
    it('creates empty result object', () => {
      const result = createGeneratorResult()

      expect(result).toEqual({
        filesWritten: [],
        filesUnchanged: [],
        errors: [],
      })
    })

    it('returns new object each time', () => {
      const result1 = createGeneratorResult()
      const result2 = createGeneratorResult()

      expect(result1).not.toBe(result2)
    })
  })

  describe('writeIfChanged', () => {
    it('writes file when it does not exist (without checksum)', () => {
      mockFs.existsSync.mockReturnValue(false)

      const result = writeIfChanged('/path/to/file.ts', 'content')

      expect(result).toBe(true)
      expect(mockFs.writeFileSync).toHaveBeenCalledWith('/path/to/file.ts', 'content')
    })

    it('does not write when content is unchanged (without checksum)', () => {
      mockFs.existsSync.mockReturnValue(true)
      mockFs.readFileSync.mockReturnValue('same content')

      const result = writeIfChanged('/path/to/file.ts', 'same content')

      expect(result).toBe(false)
    })

    it('writes when content has changed (without checksum)', () => {
      mockFs.existsSync.mockReturnValue(true)
      mockFs.readFileSync.mockReturnValue('old content')

      const result = writeIfChanged('/path/to/file.ts', 'new content')

      expect(result).toBe(true)
      expect(mockFs.writeFileSync).toHaveBeenCalledWith('/path/to/file.ts', 'new content')
    })
  })
})
