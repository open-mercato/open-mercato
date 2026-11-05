import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import * as ts from 'typescript'

const configuredAppRoot = process.env.OM_TEST_APP_ROOT?.trim()
const appRoot = configuredAppRoot ? path.resolve(configuredAppRoot) : null
const generatedRelativePath = '.mercato/generated/example-reference-index.generated.ts'
const generatedChecksumRelativePath = '.mercato/generated/example-reference-index.generated.checksum'
const pluginManifestRelativePath = '.mercato/generated/.generator-plugin-outputs.json'

function runYarn(args: string[]) {
  if (!appRoot) throw new Error('[internal] TC-EXAMPLE-016 requires OM_TEST_APP_ROOT')
  return spawnSync(process.platform === 'win32' ? 'yarn.cmd' : 'yarn', args, {
    cwd: appRoot,
    env: process.env,
    encoding: 'utf8',
    timeout: 120_000,
  })
}

function expectCommandPassed(result: ReturnType<typeof runYarn>, label: string): void {
  expect(result.status, `${label}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`).toBe(0)
}

function readStringProperty(objectLiteral: ts.ObjectLiteralExpression, propertyName: string): string | null {
  for (const property of objectLiteral.properties) {
    if (!ts.isPropertyAssignment(property)) continue
    const name = ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)
      ? property.name.text
      : null
    if (name !== propertyName || !ts.isStringLiteral(property.initializer)) continue
    return property.initializer.text
  }
  return null
}

function removeModuleActivation(source: string, moduleId: string, moduleSource: string): string {
  const sourceFile = ts.createSourceFile('modules.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)

  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== 'enabledModules') continue
      if (!declaration.initializer || !ts.isArrayLiteralExpression(declaration.initializer)) continue
      for (const element of declaration.initializer.elements) {
        if (!ts.isObjectLiteralExpression(element)) continue
        if (readStringProperty(element, 'id') !== moduleId) continue
        if (readStringProperty(element, 'from') !== moduleSource) continue
        const separator = source.slice(element.end).match(/^[ \t]*,/)
        const end = element.end + (separator?.[0].length ?? 0)
        return source.slice(0, element.getStart(sourceFile)) + source.slice(end)
      }
    }
  }

  throw new Error(`[internal] Module '${moduleId}' from '${moduleSource}' is not enabled`)
}

test.describe('TC-EXAMPLE-016: generator plugin', () => {
  test.skip(!appRoot, 'requires the disposable standalone app selected by OM_TEST_APP_ROOT')
  test.setTimeout(240_000)

  test('generates, consumes, repairs, rejects, and removes the reference index deterministically', () => {
    if (!appRoot) return

    const modulesPath = path.join(appRoot, 'src', 'modules.ts')
    const generatorsPath = path.join(appRoot, 'src', 'modules', 'example', 'generators.ts')
    const generatedPath = path.join(appRoot, generatedRelativePath)
    const generatedChecksumPath = path.join(appRoot, generatedChecksumRelativePath)
    const pluginManifestPath = path.join(appRoot, pluginManifestRelativePath)
    const bootstrapPath = path.join(appRoot, '.mercato', 'generated', 'bootstrap-registrations.generated.ts')
    const originalModules = fs.readFileSync(modulesPath, 'utf8')
    const originalGenerators = fs.readFileSync(generatorsPath, 'utf8')

    const disabledModules = removeModuleActivation(originalModules, 'example', '@app')
    expect(originalGenerators).toContain("import type { GeneratorPlugin }")
    expect(originalGenerators).not.toMatch(/^import\s+(?!type\b)/m)
    expect(fs.existsSync(generatedPath)).toBe(true)
    expect(fs.existsSync(generatedChecksumPath)).toBe(true)
    expect(JSON.parse(fs.readFileSync(pluginManifestPath, 'utf8'))).toContain(
      'example-reference-index.generated.ts',
    )

    const expectedOutput = fs.readFileSync(generatedPath, 'utf8')
    const expectedChecksum = fs.readFileSync(generatedChecksumPath, 'utf8')
    expect(expectedOutput).toContain("moduleId: 'example'")
    expect(expectedOutput).toContain('src/modules/example/reference-index')
    expect(expectedOutput).not.toContain(appRoot)
    expect(expectedOutput).not.toContain('apps/mercato')

    const firstRepeat = runYarn(['generate'])
    expectCommandPassed(firstRepeat, 'first repeated generation failed')
    expect(fs.readFileSync(generatedPath, 'utf8')).toBe(expectedOutput)
    expect(fs.readFileSync(generatedChecksumPath, 'utf8')).toBe(expectedChecksum)
    const secondRepeat = runYarn(['generate'])
    expectCommandPassed(secondRepeat, 'second repeated generation failed')
    expect(fs.readFileSync(generatedPath, 'utf8')).toBe(expectedOutput)
    expect(fs.readFileSync(generatedChecksumPath, 'utf8')).toBe(expectedChecksum)

    const consumerProbe = runYarn([
      'tsx',
      '--eval',
      `void (async () => {
        const bootstrap = await import('./.mercato/generated/bootstrap-registrations.generated.ts')
        const registry = await import('./src/modules/example/lib/module-reference-index.ts')
        bootstrap.runBootstrapRegistrations()
        const entry = registry.getModuleReferenceIndexEntry('example')
        if (!entry) throw new Error('reference index was not consumed')
        process.stdout.write(JSON.stringify(entry))
      })()`,
    ])
    expectCommandPassed(consumerProbe, 'generated reference-index consumer probe failed')
    const consumed = JSON.parse(consumerProbe.stdout) as {
      moduleId: string
      references: Array<{ capabilityId: string; sourcePaths: string[] }>
    }
    expect(consumed.moduleId).toBe('example')
    expect(consumed.references).toEqual([
      expect.objectContaining({
        capabilityId: 'module.generator-plugin',
        sourcePaths: expect.arrayContaining([
          'src/modules/example/generators.ts',
          'src/modules/example/reference-index.ts',
          'src/modules/example/lib/module-reference-index.ts',
        ]),
      }),
    ])
    for (const sourcePath of consumed.references.flatMap((reference) => reference.sourcePaths)) {
      expect(path.isAbsolute(sourcePath)).toBe(false)
      expect(sourcePath).not.toContain('..')
      expect(fs.existsSync(path.join(appRoot, sourcePath))).toBe(true)
    }

    fs.writeFileSync(generatedPath, 'stale output\n')
    const repaired = runYarn(['generate'])
    expectCommandPassed(repaired, 'generation did not repair stale plugin output')
    expect(fs.readFileSync(generatedPath, 'utf8')).toBe(expectedOutput)

    try {
      fs.writeFileSync(
        generatorsPath,
        `${originalGenerators}\ngeneratorPlugins.push({ ...generatorPlugins[0], id: 'example.reference-index.duplicate' })\n`,
      )
      const duplicate = runYarn(['generate'])
      expect(duplicate.status).not.toBe(0)
      expect(`${duplicate.stdout}\n${duplicate.stderr}`).toContain(
        "declare the same output file 'example-reference-index.generated.ts'",
      )
    } finally {
      fs.writeFileSync(generatorsPath, originalGenerators)
    }

    try {
      fs.writeFileSync(generatorsPath, `import { randomUUID } from 'node:crypto'\n${originalGenerators}`)
      const runtimeImport = runYarn(['generate'])
      expect(runtimeImport.status).not.toBe(0)
      expect(`${runtimeImport.stdout}\n${runtimeImport.stderr}`).toContain(
        'generators.ts may use only `import type`',
      )
    } finally {
      fs.writeFileSync(generatorsPath, originalGenerators)
      expectCommandPassed(runYarn(['generate']), 'generation failed after restoring generators.ts')
    }

    expect(disabledModules).not.toBe(originalModules)
    try {
      fs.writeFileSync(modulesPath, disabledModules)
      expectCommandPassed(runYarn(['generate']), 'generation failed after disabling example')
      expect(fs.existsSync(generatedPath)).toBe(false)
      expect(fs.existsSync(generatedChecksumPath)).toBe(false)
      const remainingPluginOutputs = fs.existsSync(pluginManifestPath)
        ? JSON.parse(fs.readFileSync(pluginManifestPath, 'utf8')) as string[]
        : []
      expect(remainingPluginOutputs).not.toContain('example-reference-index.generated.ts')
      expect(fs.readFileSync(bootstrapPath, 'utf8')).not.toContain('registerModuleReferenceIndexEntries')
    } finally {
      fs.writeFileSync(modulesPath, originalModules)
      expectCommandPassed(runYarn(['generate']), 'generation failed after restoring example activation')
    }
  })
})
