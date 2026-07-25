import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { calculateGenerateWatchStructureChecksum } from '../generate-watch-structure'

function write(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content)
}

describe('calculateGenerateWatchStructureChecksum', () => {
  let root: string
  let appDir: string
  let pkgModule: string
  let appModule: string

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'om-generate-watch-'))
    appDir = path.join(root, 'apps', 'mercato')
    pkgModule = path.join(root, 'packages', 'core', 'src', 'modules', 'customers')
    appModule = path.join(appDir, 'src', 'modules', 'customers')
    write(path.join(appDir, 'src', 'modules.ts'), 'export const enabledModules = []\n')
    write(path.join(pkgModule, 'index.ts'), 'export const metadata = { id: "customers" }\n')
    write(path.join(pkgModule, 'backend', 'customers', 'people', 'page.tsx'), 'export default function Page() { return null }\n')
    write(path.join(pkgModule, 'components', 'detail', 'PersonDetailTabs.tsx'), 'export function PersonDetailTabs() { return null }\n')
  })

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  function currentChecksum(): string {
    return calculateGenerateWatchStructureChecksum({
      modulesFile: path.join(appDir, 'src', 'modules.ts'),
      moduleRoots: [{ appBase: appModule, pkgBase: pkgModule }],
    })
  }

  it('ignores ordinary component edits outside generator discovery paths', () => {
    const before = currentChecksum()

    write(path.join(pkgModule, 'components', 'detail', 'PersonDetailTabs.tsx'), 'export function PersonDetailTabs() { return "changed" }\n')

    expect(currentChecksum()).toBe(before)
  })

  it('changes when a discovered backend page is added', () => {
    const before = currentChecksum()

    write(path.join(pkgModule, 'backend', 'customers', 'companies', 'page.tsx'), 'export default function Page() { return null }\n')

    expect(currentChecksum()).not.toBe(before)
  })

  it('changes when route metadata changes', () => {
    write(path.join(pkgModule, 'backend', 'customers', 'people', 'page.meta.ts'), 'export const metadata = { nav: { label: "People" } }\n')
    const before = currentChecksum()

    write(path.join(pkgModule, 'backend', 'customers', 'people', 'page.meta.ts'), 'export const metadata = { nav: { label: "Contacts" } }\n')

    expect(currentChecksum()).not.toBe(before)
  })

  it('changes when inline page metadata changes', () => {
    write(path.join(pkgModule, 'backend', 'customers', 'people', 'page.tsx'), 'export const metadata = { nav: { label: "People" } }\nexport default function Page() { return null }\n')
    const before = currentChecksum()

    write(path.join(pkgModule, 'backend', 'customers', 'people', 'page.tsx'), 'export const metadata = { nav: { label: "Contacts" } }\nexport default function Page() { return null }\n')

    expect(currentChecksum()).not.toBe(before)
  })

  it('changes when a convention file changes', () => {
    const before = currentChecksum()

    write(path.join(pkgModule, 'acl.ts'), 'export const features = [{ id: "customers.view" }]\n')

    expect(currentChecksum()).not.toBe(before)
  })

  it('changes when a discovered worker is added and removed', () => {
    const before = currentChecksum()
    const workerPath = path.join(pkgModule, 'workers', 'sync-customers.ts')

    write(workerPath, 'export default async function syncCustomers() {}\n')
    const afterAdd = currentChecksum()
    expect(afterAdd).not.toBe(before)

    fs.rmSync(workerPath)
    expect(currentChecksum()).toBe(before)
  })

  it('changes when the module registry configuration changes', () => {
    const before = currentChecksum()

    write(path.join(appDir, 'src', 'modules.ts'), 'export const enabledModules = ["customers"]\n')

    expect(currentChecksum()).not.toBe(before)
  })
})
