import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createResolver } from '../resolver'

describe('installed package paths in monorepos', () => {
  let root: string
  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'resolver-packages-')))
    fs.mkdirSync(path.join(root, 'packages', 'core', 'src', 'modules'), { recursive: true })
    fs.writeFileSync(path.join(root, 'packages', 'core', 'package.json'), JSON.stringify({ name: '@open-mercato/core' }))
    fs.mkdirSync(path.join(root, 'node_modules', '@open-mercato'), { recursive: true })
    fs.symlinkSync(path.join(root, 'packages', 'core'), path.join(root, 'node_modules', '@open-mercato', 'core'))
    fs.mkdirSync(path.join(root, 'apps', 'mercato', 'src'), { recursive: true })
    fs.writeFileSync(path.join(root, 'apps', 'mercato', 'package.json'), JSON.stringify({ name: 'app' }))
  })
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

  it.each(['@pkarw/consents', '@open-mercato/consents', 'consents'])('resolves installed package %s without falling back to core', (packageName) => {
    const packageRoot = path.join(root, 'node_modules', packageName)
    fs.mkdirSync(path.join(packageRoot, 'dist', 'modules', 'consents'), { recursive: true })
    fs.writeFileSync(path.join(packageRoot, 'package.json'), JSON.stringify({ name: packageName }))
    const resolver = createResolver(path.join(root, 'apps', 'mercato'))
    expect(resolver.isMonorepo()).toBe(true)
    expect(resolver.getPackageRoot(packageName)).toBe(packageRoot)
    expect(resolver.getModulePaths({ id: 'consents', from: packageName }).pkgBase).toBe(path.join(packageRoot, 'dist', 'modules', 'consents'))
    expect(resolver.getModulePaths({ id: 'customers', from: '@open-mercato/core' }).pkgBase).toBe(path.join(root, 'packages', 'core', 'src', 'modules', 'customers'))
  })
})
