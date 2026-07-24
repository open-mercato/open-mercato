import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createGeneratorResult, readChecksumRecord, writeGeneratedFile } from '../utils'

describe('content-stable generated writes', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'generated-write-test-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('updates structure checksum state without touching byte-identical generated output', () => {
    const outFile = path.join(tmpDir, 'modules.generated.ts')
    const checksumFile = path.join(tmpDir, 'modules.generated.checksum')
    const content = '// generated\nexport const modules = []\n'

    writeGeneratedFile({
      outFile,
      checksumFile,
      content,
      structureChecksum: 'structure-a',
      result: createGeneratorResult(),
      quiet: true,
    })

    const oldTime = new Date(Date.now() - 60_000)
    fs.utimesSync(outFile, oldTime, oldTime)
    fs.utimesSync(checksumFile, oldTime, oldTime)
    const outputMtimeBefore = fs.statSync(outFile).mtimeMs

    const result = createGeneratorResult()
    writeGeneratedFile({
      outFile,
      checksumFile,
      content,
      structureChecksum: 'structure-b',
      result,
      quiet: true,
    })

    expect(result.filesWritten).toEqual([])
    expect(result.filesUnchanged).toEqual([outFile])
    expect(fs.statSync(outFile).mtimeMs).toBe(outputMtimeBefore)
    expect(fs.statSync(checksumFile).mtimeMs).toBeGreaterThan(oldTime.getTime())
    expect(readChecksumRecord(checksumFile)?.structure).toBe('structure-b')
  })

  it('rewrites generated output when its actual bytes change', () => {
    const outFile = path.join(tmpDir, 'modules.generated.ts')
    const checksumFile = path.join(tmpDir, 'modules.generated.checksum')
    fs.writeFileSync(outFile, 'stale output\n')

    const result = createGeneratorResult()
    const content = '// generated\nexport const modules = ["customers"]\n'
    writeGeneratedFile({
      outFile,
      checksumFile,
      content,
      structureChecksum: 'structure-c',
      result,
      quiet: true,
    })

    expect(result.filesWritten).toEqual([outFile])
    expect(result.filesUnchanged).toEqual([])
    expect(fs.readFileSync(outFile, 'utf8')).toBe(content)
    expect(readChecksumRecord(checksumFile)?.structure).toBe('structure-c')
  })
})
