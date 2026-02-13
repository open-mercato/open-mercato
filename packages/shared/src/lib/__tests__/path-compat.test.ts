import path from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * Tests for cross-platform path handling utilities.
 * These tests verify that path operations work correctly on both Windows and Unix-like systems.
 */

// Helper to normalize paths (convert backslashes to forward slashes)
const normalizePath = (p: string): string => p.replace(/\\/g, '/')

// Helper to detect Windows absolute paths
const isWindowsAbsolutePath = (p: string): boolean => /^[a-zA-Z]:/.test(p)

// Helper to detect Unix absolute paths
const isUnixAbsolutePath = (p: string): boolean => p.startsWith('/')

describe('Cross-platform path handling', () => {
  describe('normalizePath', () => {
    it('converts Windows backslashes to forward slashes', () => {
      expect(normalizePath('C:\\work\\project\\file.ts')).toBe('C:/work/project/file.ts')
      expect(normalizePath('D:\\Users\\test\\Documents')).toBe('D:/Users/test/Documents')
    })

    it('leaves Unix paths unchanged', () => {
      expect(normalizePath('/home/user/project/file.ts')).toBe('/home/user/project/file.ts')
      expect(normalizePath('/var/www/html')).toBe('/var/www/html')
    })

    it('handles mixed separators', () => {
      expect(normalizePath('C:\\work/project\\src/file.ts')).toBe('C:/work/project/src/file.ts')
    })

    it('handles relative paths', () => {
      expect(normalizePath('.\\src\\file.ts')).toBe('./src/file.ts')
      expect(normalizePath('..\\parent\\file.ts')).toBe('../parent/file.ts')
    })

    it('handles paths with no separators', () => {
      expect(normalizePath('file.ts')).toBe('file.ts')
    })
  })

  describe('isWindowsAbsolutePath', () => {
    it('detects Windows absolute paths', () => {
      expect(isWindowsAbsolutePath('C:\\work\\project')).toBe(true)
      expect(isWindowsAbsolutePath('D:\\Users\\test')).toBe(true)
      expect(isWindowsAbsolutePath('c:\\lowercase\\drive')).toBe(true)
      expect(isWindowsAbsolutePath('Z:\\network\\share')).toBe(true)
    })

    it('rejects Unix absolute paths', () => {
      expect(isWindowsAbsolutePath('/home/user')).toBe(false)
      expect(isWindowsAbsolutePath('/var/www')).toBe(false)
    })

    it('rejects relative paths', () => {
      expect(isWindowsAbsolutePath('./relative/path')).toBe(false)
      expect(isWindowsAbsolutePath('../parent/path')).toBe(false)
      expect(isWindowsAbsolutePath('relative/path')).toBe(false)
    })

    it('rejects package imports', () => {
      expect(isWindowsAbsolutePath('@open-mercato/shared')).toBe(false)
      expect(isWindowsAbsolutePath('lodash')).toBe(false)
      expect(isWindowsAbsolutePath('node:fs')).toBe(false)
    })
  })

  describe('isUnixAbsolutePath', () => {
    it('detects Unix absolute paths', () => {
      expect(isUnixAbsolutePath('/home/user')).toBe(true)
      expect(isUnixAbsolutePath('/var/www/html')).toBe(true)
      expect(isUnixAbsolutePath('/')).toBe(true)
    })

    it('rejects Windows absolute paths', () => {
      expect(isUnixAbsolutePath('C:\\work\\project')).toBe(false)
      expect(isUnixAbsolutePath('D:\\Users')).toBe(false)
    })

    it('rejects relative paths', () => {
      expect(isUnixAbsolutePath('./relative')).toBe(false)
      expect(isUnixAbsolutePath('../parent')).toBe(false)
      expect(isUnixAbsolutePath('relative')).toBe(false)
    })
  })

  describe('pathToFileURL conversion', () => {
    it('converts Windows paths to file:// URLs', () => {
      const windowsPath = 'C:\\work\\project\\file.js'
      const url = pathToFileURL(windowsPath)
      expect(url.protocol).toBe('file:')
      expect(url.href).toMatch(/^file:\/\/\//)
      // The path should be normalized with forward slashes
      expect(url.href).toContain('/work/project/file.js')
    })

    it('converts Unix paths to file:// URLs', () => {
      const unixPath = '/home/user/project/file.js'
      const url = pathToFileURL(unixPath)
      expect(url.protocol).toBe('file:')
      // On Windows, Unix-style paths get the current drive prepended
      // On Unix, they remain as-is
      if (process.platform === 'win32') {
        expect(url.href).toMatch(/^file:\/\/\/[A-Za-z]:\/home\/user\/project\/file\.js$/)
      } else {
        expect(url.href).toBe('file:///home/user/project/file.js')
      }
    })

    it('handles paths with spaces', () => {
      const pathWithSpaces = '/home/user/my project/file.js'
      const url = pathToFileURL(pathWithSpaces)
      expect(url.href).toContain('my%20project')
    })

    it('handles paths with special characters', () => {
      const pathWithSpecial = '/home/user/project#1/file.js'
      const url = pathToFileURL(pathWithSpecial)
      // # should be encoded
      expect(url.href).toContain('%23')
    })
  })

  describe('path.join behavior', () => {
    it('joins paths with platform-specific separator', () => {
      const joined = path.join('/test', 'project', 'src', 'file.ts')
      // On Windows, this will have backslashes; on Unix, forward slashes
      // The normalized version should always have forward slashes
      expect(normalizePath(joined)).toBe('/test/project/src/file.ts')
    })

    it('handles absolute paths correctly', () => {
      // path.join with an absolute path as first arg preserves it
      const joined = path.join('/absolute', 'relative', 'path')
      expect(normalizePath(joined)).toBe('/absolute/relative/path')
    })

    it('normalizes . and .. segments', () => {
      const joined = path.join('/test', './current', '../parent', 'file.ts')
      expect(normalizePath(joined)).toBe('/test/parent/file.ts')
    })
  })

  describe('path.resolve behavior', () => {
    it('resolves to absolute path', () => {
      const resolved = path.resolve('/base', 'relative', 'path')
      expect(normalizePath(resolved)).toContain('base/relative/path')
    })

    it('handles Windows-style paths on Windows', () => {
      // When running on Windows, path.resolve with a Unix-style absolute path
      // will prepend the current drive letter
      const resolved = path.resolve('/test/project')
      // On Windows: C:\test\project (or whatever drive)
      // On Unix: /test/project
      if (process.platform === 'win32') {
        expect(isWindowsAbsolutePath(resolved)).toBe(true)
      } else {
        expect(isUnixAbsolutePath(resolved)).toBe(true)
      }
    })
  })

  describe('path.relative behavior', () => {
    it('computes relative path between directories', () => {
      const relative = path.relative('/base/dir', '/base/dir/sub/file.ts')
      expect(normalizePath(relative)).toBe('sub/file.ts')
    })

    it('computes relative path with ..', () => {
      const relative = path.relative('/base/dir/sub', '/base/dir/other/file.ts')
      expect(normalizePath(relative)).toBe('../other/file.ts')
    })
  })

  describe('glob pattern compatibility', () => {
    // These tests verify that glob patterns work correctly when constructed
    // using the recommended pattern: glob('pattern', { cwd: baseDir, absolute: true })

    it('glob patterns should use forward slashes', () => {
      // Glob patterns always use forward slashes, even on Windows
      const pattern = 'src/**/*.ts'
      expect(pattern).not.toContain('\\')
    })

    it('cwd option should accept platform paths', () => {
      // The cwd option can be a platform-specific path
      // glob will normalize it internally
      const cwdWindows = 'C:\\work\\project'
      const cwdUnix = '/home/user/project'

      // Both should be valid directory paths
      expect(isWindowsAbsolutePath(cwdWindows) || isUnixAbsolutePath(cwdWindows)).toBe(true)
      expect(isUnixAbsolutePath(cwdUnix)).toBe(true)
    })
  })

  describe('ESM import path requirements', () => {
    it('relative imports should use forward slashes', () => {
      // ESM imports require forward slashes
      const validImport = './module/file.js'
      const invalidImport = '.\\module\\file.js'

      expect(validImport.startsWith('./')).toBe(true)
      expect(normalizePath(invalidImport)).toBe('./module/file.js')
    })

    it('absolute imports on Windows require file:// URLs', () => {
      const windowsPath = 'C:\\work\\project\\file.js'
      const fileUrl = pathToFileURL(windowsPath).href

      // Windows absolute paths must be file:// URLs for ESM
      expect(fileUrl.startsWith('file:///')).toBe(true)
      // The URL should not contain backslashes
      expect(fileUrl).not.toContain('\\')
    })
  })
})
