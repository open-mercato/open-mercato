import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import childProcess from 'node:child_process'
import spawn from 'cross-spawn'
import { inspectNpmModuleTarget } from '../module-inspection'

describe('module artifact inspection', () => {
  let root: string
  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'module-inspection-test-')) })
  afterEach(() => { jest.restoreAllMocks(); fs.rmSync(root, { recursive: true, force: true }) })

  it('inspects large packages whose artifact indexes exceed the subprocess default buffer', () => {
    const files = Array.from({ length: 20_000 }, (_, index) => `package/assets/${'fixture'.repeat(10)}-${index}.txt`)
    const archiveIndex = ['package/src/modules/example/index.ts', 'package/dist/modules/example/index.js', ...files].join('\n')
    const packOutput = JSON.stringify([{ name: '@vendor/example', version: '1.2.3', filename: 'candidate.tgz', files: files.map((filePath) => ({ path: filePath, size: 1, mode: 420 })) }])
    jest.spyOn(spawn, 'sync').mockImplementation((_command, _args, options) => {
      if ((options?.maxBuffer ?? 1024 * 1024) < Buffer.byteLength(packOutput)) throw new Error('maxBuffer exceeded')
      return { status: 0, stdout: packOutput, stderr: '', pid: 1, output: [], signal: null }
    })
    jest.spyOn(childProcess, 'execFileSync').mockImplementation((_command, args, options) => {
      if (args?.[0] === '-xOf') return JSON.stringify({ name: '@vendor/example', version: '1.2.3' })
      if ((options?.maxBuffer ?? 1024 * 1024) < Buffer.byteLength(archiveIndex)) throw new Error('maxBuffer exceeded')
      return archiveIndex
    })
    expect(inspectNpmModuleTarget('@vendor/example@next', '@vendor/example', root).moduleIds).toEqual(['example'])
  })

  it('validates selected and active modules without requiring exports for parked modules', () => {
    const packageRoot = path.join(root, 'candidate')
    for (const moduleId of ['alpha', 'beta']) {
      for (const directory of ['src', 'dist']) {
        const moduleRoot = path.join(packageRoot, directory, 'modules', moduleId)
        fs.mkdirSync(moduleRoot, { recursive: true })
        fs.writeFileSync(path.join(moduleRoot, directory === 'src' ? 'index.ts' : 'index.js'), 'export const metadata = {}')
      }
    }
    fs.writeFileSync(path.join(packageRoot, 'package.json'), JSON.stringify({
      name: '@vendor/example', exports: { './modules/alpha/index': null, './modules/beta/index': './dist/modules/beta/index.js' },
    }))
    expect(inspectNpmModuleTarget('@vendor/example@file:./candidate', '@vendor/example', root, ['beta']).moduleIds).toEqual(['alpha', 'beta'])
    expect(() => inspectNpmModuleTarget('@vendor/example@file:./candidate', '@vendor/example', root, ['alpha', 'beta'])).toThrow('@vendor/example/modules/alpha/index')
  })

  it.each(['directory', 'archive'])('keeps private lowercase helpers private during %s inspection', (kind) => {
    const packageRoot = path.join(root, 'package')
    const sources = { 'index.ts': 'export const metadata = {}', 'backend/form-utils.tsx': "throw new Error('must not execute'); export const renderLabel = () => null", 'backend/orders/page.tsx': 'export default function Page() {}' }
    const exports = { './modules/example/index': './dist/modules/example/index.js', './modules/example/backend/orders/page': './dist/modules/example/backend/orders/page.js' }
    fs.mkdirSync(packageRoot, { recursive: true })
    fs.writeFileSync(path.join(packageRoot, 'package.json'), JSON.stringify({ name: '@vendor/example', version: '1.0.0', exports }))
    for (const [file, content] of Object.entries(sources)) {
      for (const relativePath of [`src/modules/example/${file}`, `dist/modules/example/${file.replace(/\.tsx?$/, '.js')}`]) {
        fs.mkdirSync(path.dirname(path.join(packageRoot, relativePath)), { recursive: true })
        fs.writeFileSync(path.join(packageRoot, relativePath), content)
      }
    }
    if (kind === 'archive') childProcess.execFileSync('tar', ['-czf', path.join(root, 'candidate.tgz'), '-C', root, 'package'])
    const specifier = '@vendor/example@file:./' + (kind === 'archive' ? 'candidate.tgz' : 'package')
    expect(inspectNpmModuleTarget(specifier, '@vendor/example', root).moduleIds).toEqual(['example'])
    fs.writeFileSync(path.join(packageRoot, 'package.json'), JSON.stringify({ name: '@vendor/example', exports: { ...exports, './modules/example/backend/orders/page': null } }))
    if (kind === 'archive') childProcess.execFileSync('tar', ['-czf', path.join(root, 'candidate.tgz'), '-C', root, 'package'])
    expect(() => inspectNpmModuleTarget(specifier, '@vendor/example', root)).toThrow('backend/orders/page')
  })

  it('inspects file packages without executing package scripts or writing app files', () => {
    const packageRoot = path.join(root, 'candidate')
    fs.mkdirSync(path.join(packageRoot, 'src/modules/example'), { recursive: true })
    fs.mkdirSync(path.join(packageRoot, 'dist/modules/example'), { recursive: true })
    fs.writeFileSync(path.join(packageRoot, 'dist/modules/example/index.js'), 'export const metadata = {}')
    fs.writeFileSync(path.join(packageRoot, 'package.json'), JSON.stringify({ name: '@vendor/example', scripts: { prepare: 'exit 1' } }))
    fs.writeFileSync(path.join(packageRoot, 'src/modules/example/index.ts'), 'export const metadata = {}')
    const execute = jest.spyOn(childProcess, 'execFileSync')
    expect(inspectNpmModuleTarget('@vendor/example@file:./candidate', '@vendor/example', root)).toMatchObject({ moduleIds: ['example'], locator: 'npm:@vendor/example' })
    expect(execute).not.toHaveBeenCalled()
    expect(fs.readdirSync(root)).toEqual(['candidate'])
  })

  it('preserves npm tags while recording the inspected version and disables lifecycle scripts', () => {
    const execute = jest.spyOn(childProcess, 'execFileSync').mockImplementation((_command, args) => args?.[0] === '-xOf'
      ? JSON.stringify({ name: '@vendor/example', version: '1.2.3' })
      : 'package/src/modules/example/index.ts\npackage/dist/modules/example/index.js\n')
    jest.spyOn(spawn, 'sync').mockImplementation((_command, args) => {
      expect(args).toEqual(expect.arrayContaining(['pack', '@vendor/example@next', '--ignore-scripts', '--json', '--pack-destination']))
      return { status: 0, stdout: JSON.stringify([{ name: '@vendor/example', version: '1.2.3', filename: 'candidate.tgz' }]), stderr: '', pid: 1, output: [], signal: null }
    })
    expect(inspectNpmModuleTarget('@vendor/example@next', '@vendor/example', root)).toEqual({ packageName: '@vendor/example', packageSpec: '@vendor/example@next', version: '1.2.3', moduleIds: ['example'], locator: 'npm:@vendor/example' })
    expect(execute).toHaveBeenCalledTimes(2)
    expect(fs.readdirSync(root)).toEqual([])
  })

  it('inspects a real file tarball without extracting it or executing entrypoints', () => {
    const packageRoot = path.join(root, 'package')
    for (const directory of ['src/modules/example', 'dist/modules/example']) fs.mkdirSync(path.join(packageRoot, directory), { recursive: true })
    fs.writeFileSync(path.join(packageRoot, 'package.json'), JSON.stringify({ name: '@vendor/example', version: '2.3.4' }))
    fs.writeFileSync(path.join(packageRoot, 'src/modules/example/index.ts'), "throw new Error('must not execute')")
    fs.writeFileSync(path.join(packageRoot, 'dist/modules/example/index.js'), "throw new Error('must not execute')")
    const archive = path.join(root, 'candidate.tgz')
    childProcess.execFileSync('tar', ['-czf', archive, '-C', root, 'package'])
    fs.rmSync(packageRoot, { recursive: true })
    expect(inspectNpmModuleTarget('@vendor/example@file:./candidate.tgz', '@vendor/example', root)).toMatchObject({ version: '2.3.4', moduleIds: ['example'] })
    expect(fs.readdirSync(root)).toEqual(['candidate.tgz'])
  })

  it('rejects file directories missing compiled descriptors before package installation', () => {
    const packageRoot = path.join(root, 'candidate')
    fs.mkdirSync(path.join(packageRoot, 'src/modules/example'), { recursive: true })
    fs.writeFileSync(path.join(packageRoot, 'package.json'), JSON.stringify({ name: '@vendor/example' }))
    fs.writeFileSync(path.join(packageRoot, 'src/modules/example/index.ts'), 'export const metadata = {}')
    expect(() => inspectNpmModuleTarget('@vendor/example@file:./candidate', '@vendor/example', root)).toThrow('Build the package')
  })

  it('rejects packed artifact version disagreement without exposing output', () => {
    jest.spyOn(childProcess, 'execFileSync').mockImplementation((_command, args) => args?.[0] === '-xOf'
      ? JSON.stringify({ name: '@vendor/example', version: '9.9.9' })
      : 'package/src/modules/example/index.ts\npackage/dist/modules/example/index.js\n')
    jest.spyOn(spawn, 'sync').mockReturnValue({ status: 0, stdout: JSON.stringify([{ name: '@vendor/example', version: '1.2.3', filename: 'candidate.tgz' }]), stderr: '', pid: 1, output: [], signal: null })
    expect(() => inspectNpmModuleTarget('@vendor/example@next', '@vendor/example', root)).toThrow('No package was installed')
  })

  it.each([0, 1])('mirrors scoped Yarn authentication and removes the temporary npmrc after status %s', (status) => {
    fs.writeFileSync(path.join(root, '.yarnrc.yml'), 'npmScopes: {}')
    const config: Record<string, unknown> = {
      npmRegistryServer: 'https://registry.npmjs.org',
      npmScopes: { vendor: { npmRegistryServer: 'https://private.example.test/npm/' } },
      npmRegistries: { '//private.example.test/npm': { npmAuthToken: 'test-token-do-not-print' } },
      npmAuthToken: null,
      npmAuthIdent: null,
    }
    jest.spyOn(childProcess, 'execFileSync').mockImplementation((_command, args) => args?.[0] === '-xOf'
      ? JSON.stringify({ name: '@vendor/example', version: '1.2.3' })
      : 'package/src/modules/example/index.ts\npackage/dist/modules/example/index.js\n')
    let temporaryConfig: string | undefined
    jest.spyOn(spawn, 'sync').mockImplementation((command, args) => {
      if (command === 'yarn' || command === 'yarn.cmd') return { status: 0, stdout: JSON.stringify(config[String(args?.[2])]), stderr: '', pid: 1, output: [], signal: null }
      const values = args ?? []
      temporaryConfig = String(values[values.indexOf('--userconfig') + 1])
      expect(fs.statSync(temporaryConfig).mode & 0o777).toBe(0o600)
      expect(fs.readFileSync(temporaryConfig, 'utf8')).toContain('//private.example.test/npm/:_authToken="test-token-do-not-print"')
      expect(values).toContain('--@vendor:registry=https://private.example.test/npm/')
      expect(values.join(' ')).not.toContain('test-token-do-not-print')
      return { status, stdout: JSON.stringify([{ name: '@vendor/example', version: '1.2.3', filename: 'candidate.tgz' }]), stderr: 'test-token-do-not-print', pid: 1, output: [], signal: null }
    })
    if (status === 0) expect(inspectNpmModuleTarget('@vendor/example@next', '@vendor/example', root).version).toBe('1.2.3')
    else expect(() => inspectNpmModuleTarget('@vendor/example@next', '@vendor/example', root)).toThrow('No package was installed')
    expect(temporaryConfig).toBeDefined()
    expect(fs.existsSync(temporaryConfig!)).toBe(false)
  })

  it('fails closed on unavailable inspection without exposing private tool output', () => {
    jest.spyOn(spawn, 'sync').mockImplementation(() => { throw new Error('private registry token') })
    expect(() => inspectNpmModuleTarget('@vendor/example@next', '@vendor/example', root)).toThrow('No package was installed')
    try { inspectNpmModuleTarget('@vendor/example@next', '@vendor/example', root) } catch (error) {
      expect(String(error)).not.toContain('private registry token')
    }
    expect(fs.readdirSync(root)).toEqual([])
  })
})
