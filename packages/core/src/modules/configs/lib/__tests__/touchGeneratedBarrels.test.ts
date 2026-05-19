import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { findGeneratedDir, touchGeneratedBarrels } from '../touchGeneratedBarrels'

function makeTmp(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

function setMtime(filePath: string, when: Date): void {
  fs.utimesSync(filePath, when, when)
}

describe('touchGeneratedBarrels', () => {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)

  it('rewrites every .generated.ts and .generated.checksum file with identical bytes and a fresh mtime', () => {
    const root = makeTmp('touch-barrels-')
    try {
      const generatedDir = path.join(root, '.mercato', 'generated')
      fs.mkdirSync(generatedDir, { recursive: true })

      const tsFile = path.join(generatedDir, 'modules.app.generated.ts')
      const checksumFile = path.join(generatedDir, 'modules.app.generated.checksum')
      const unrelatedFile = path.join(generatedDir, 'README.txt')

      const tsContent = '// AUTO-GENERATED\nexport const x = 1\n'
      const checksumContent = '{"content":"abc","structure":"def"}\n'
      const unrelatedContent = 'leave me alone'

      fs.writeFileSync(tsFile, tsContent)
      fs.writeFileSync(checksumFile, checksumContent)
      fs.writeFileSync(unrelatedFile, unrelatedContent)
      setMtime(tsFile, oneHourAgo)
      setMtime(checksumFile, oneHourAgo)
      setMtime(unrelatedFile, oneHourAgo)

      const result = touchGeneratedBarrels({ cwd: root, quiet: true })

      expect(result.generatedDir).toBe(generatedDir)
      expect(result.files.sort()).toEqual([checksumFile, tsFile].sort())
      expect(fs.readFileSync(tsFile, 'utf8')).toBe(tsContent)
      expect(fs.readFileSync(checksumFile, 'utf8')).toBe(checksumContent)
      expect(fs.readFileSync(unrelatedFile, 'utf8')).toBe(unrelatedContent)
      expect(fs.statSync(tsFile).mtimeMs).toBeGreaterThan(oneHourAgo.getTime())
      expect(fs.statSync(checksumFile).mtimeMs).toBeGreaterThan(oneHourAgo.getTime())
      const unrelatedMtimeDelta = Math.abs(fs.statSync(unrelatedFile).mtimeMs - oneHourAgo.getTime())
      expect(unrelatedMtimeDelta).toBeLessThan(10)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('returns an empty result without throwing when .mercato/generated does not exist', () => {
    const root = makeTmp('touch-barrels-empty-')
    try {
      const result = touchGeneratedBarrels({ cwd: root, quiet: true })
      expect(result.generatedDir).toBeNull()
      expect(result.files).toEqual([])
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('walks up the directory tree to find the generated dir', () => {
    const root = makeTmp('touch-barrels-walk-')
    try {
      const generatedDir = path.join(root, '.mercato', 'generated')
      fs.mkdirSync(generatedDir, { recursive: true })
      fs.writeFileSync(path.join(generatedDir, 'foo.generated.ts'), 'x')

      const nested = path.join(root, 'src', 'deep', 'inside')
      fs.mkdirSync(nested, { recursive: true })

      expect(findGeneratedDir(nested)).toBe(generatedDir)

      const result = touchGeneratedBarrels({ cwd: nested, quiet: true })
      expect(result.generatedDir).toBe(generatedDir)
      expect(result.files).toHaveLength(1)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('logs a single confirmation line in non-quiet mode', () => {
    const root = makeTmp('touch-barrels-log-')
    try {
      const generatedDir = path.join(root, '.mercato', 'generated')
      fs.mkdirSync(generatedDir, { recursive: true })
      fs.writeFileSync(path.join(generatedDir, 'a.generated.ts'), 'a')
      fs.writeFileSync(path.join(generatedDir, 'b.generated.checksum'), 'b')

      const messages: string[] = []
      const result = touchGeneratedBarrels({
        cwd: root,
        log: (message) => messages.push(message),
      })
      expect(result.files).toHaveLength(2)
      expect(messages).toHaveLength(1)
      expect(messages[0]).toContain('touched 2 generated barrel(s)')
      expect(messages[0]).toContain(generatedDir)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})
