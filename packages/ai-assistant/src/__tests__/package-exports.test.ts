import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import ts from 'typescript'

const packageDir = path.resolve(__dirname, '../..')

describe('published ai-assistant root export', () => {
  it.each([
    ['bundler', ts.ModuleResolutionKind.Bundler, ts.ModuleKind.ESNext],
    ['NodeNext', ts.ModuleResolutionKind.NodeNext, ts.ModuleKind.NodeNext],
  ])('resolves root types outside workspace aliases with %s', (_name, moduleResolution, module) => {
    const consumerDir = realpathSync(mkdtempSync(path.join(tmpdir(), 'ai-assistant-consumer-')))
    try {
      const installedDir = path.join(consumerDir, 'node_modules/@open-mercato/ai-assistant')
      mkdirSync(installedDir, { recursive: true })
      const packResult = JSON.parse(execFileSync('npm', [
        'pack', '--ignore-scripts', '--json', '--pack-destination', consumerDir,
      ], { cwd: packageDir, encoding: 'utf8', timeout: 20000 })) as Array<{ filename: string }>
      execFileSync('tar', ['-xzf', path.join(consumerDir, packResult[0].filename),
        '--strip-components=1', '-C', installedDir], { timeout: 10000 })
      writeFileSync(path.join(consumerDir, 'package.json'), JSON.stringify({ type: 'module' }))
      const consumerFile = path.join(consumerDir, 'index.ts')
      writeFileSync(consumerFile, "export const loadAssistant = () => import('@open-mercato/ai-assistant')\n")
      const resolved = ts.resolveModuleName('@open-mercato/ai-assistant', consumerFile, {
        moduleResolution, module, strict: true,
      }, ts.sys).resolvedModule

      expect(resolved?.resolvedFileName).toBe(path.join(installedDir, 'src/index.ts'))
      expect(resolved?.isExternalLibraryImport).toBe(true)
      expect(existsSync(resolved?.resolvedFileName ?? '')).toBe(true)
      const manifest = JSON.parse(readFileSync(path.join(installedDir, 'package.json'), 'utf8'))
      expect(manifest.exports['.'].default).toBe('./dist/index.js')
      expect(manifest.main).toBe('./dist/index.js')
    } finally {
      rmSync(consumerDir, { recursive: true, force: true })
    }
  })
})
