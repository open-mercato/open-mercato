import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  ensureMikroOrmV7GeneratedCacheCompatibility,
  recoverMikroOrmV7GeneratedCacheFromImportError,
  shouldRecoverMikroOrmV7GeneratedCache,
} from '../generatedCacheRecovery'

function createAppRoot(tempDir: string): { appRoot: string; generatedDir: string } {
  const appRoot = path.join(tempDir, 'apps', 'mercato')
  const generatedDir = path.join(appRoot, '.mercato', 'generated')
  fs.mkdirSync(generatedDir, { recursive: true })
  return { appRoot, generatedDir }
}

describe('generatedCacheRecovery', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'open-mercato-generated-cache-recovery-'))
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('removes stale generated .mjs bundles and writes a marker file', () => {
    const { appRoot, generatedDir } = createAppRoot(tempDir)
    const stalePath = path.join(generatedDir, 'entities.generated.mjs')
    const companionPath = path.join(generatedDir, 'modules.cli.generated.mjs')
    const warnings: string[] = []

    fs.writeFileSync(stalePath, 'import { Entity, PrimaryKey, Property } from "@mikro-orm/core";\n')
    fs.writeFileSync(companionPath, 'export const modules = []\n')

    const result = ensureMikroOrmV7GeneratedCacheCompatibility(appRoot, {
      logger: { warn: (message) => warnings.push(message) },
    })

    expect(result.applied).toBe(true)
    expect(fs.existsSync(stalePath)).toBe(false)
    expect(fs.existsSync(companionPath)).toBe(false)
    expect(result.markerPath).not.toBeNull()
    expect(result.deletedFiles).toHaveLength(2)
    expect(result.deletedFiles).toEqual(expect.arrayContaining([companionPath, stalePath]))
    expect(fs.existsSync(result.markerPath!)).toBe(true)
    expect(warnings.some((message) => message.includes('MikroORM to version 7'))).toBe(true)
  })

  it('does nothing when the generated cache is already compatible', () => {
    const { appRoot, generatedDir } = createAppRoot(tempDir)
    const cleanPath = path.join(generatedDir, 'entities.generated.mjs')

    fs.writeFileSync(cleanPath, 'import { Entity } from "@mikro-orm/decorators/legacy";\n')

    const result = ensureMikroOrmV7GeneratedCacheCompatibility(appRoot)

    expect(result.applied).toBe(false)
    expect(result.deletedFiles).toEqual([])
    expect(result.markerPath).toBeNull()
    expect(fs.existsSync(cleanPath)).toBe(true)
  })

  it('retries recovery when the import error matches the MikroORM decorator export failure', () => {
    const { appRoot, generatedDir } = createAppRoot(tempDir)
    const stalePath = path.join(generatedDir, 'entities.generated.mjs')

    fs.writeFileSync(stalePath, 'import { Entity, PrimaryKey, Property } from "@mikro-orm/core";\n')

    const result = recoverMikroOrmV7GeneratedCacheFromImportError(
      appRoot,
      new SyntaxError("The requested module '@mikro-orm/core' does not provide an export named 'Entity'"),
      { logger: { warn: () => undefined } },
    )

    expect(result.applied).toBe(true)
    expect(fs.existsSync(stalePath)).toBe(false)
  })

  it('recognizes the MikroORM v7 decorator export error signature', () => {
    expect(
      shouldRecoverMikroOrmV7GeneratedCache(
        new Error("The requested module '@mikro-orm/core' does not provide an export named 'Entity'"),
      ),
    ).toBe(true)
    expect(shouldRecoverMikroOrmV7GeneratedCache(new Error('Some other bootstrap error'))).toBe(false)
  })
})
