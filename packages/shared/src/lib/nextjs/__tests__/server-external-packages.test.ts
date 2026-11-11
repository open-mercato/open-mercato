import fs from 'node:fs'
import path from 'node:path'

import { openMercatoServerExternalPackages } from '../server-external-packages'

type PackageManifest = {
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
}

function readInstalledManifest(packageName: string): PackageManifest | null {
  let directory = __dirname
  for (;;) {
    const candidate = path.join(directory, 'node_modules', packageName, 'package.json')
    if (fs.existsSync(candidate)) return JSON.parse(fs.readFileSync(candidate, 'utf8')) as PackageManifest
    const parent = path.dirname(directory)
    if (parent === directory) return null
    directory = parent
  }
}

describe('openMercatoServerExternalPackages', () => {
  it.each(openMercatoServerExternalPackages.map((name) => [name]))(
    '%s is installed and does not depend on React',
    (packageName) => {
      const manifest = readInstalledManifest(packageName)
      expect(manifest).not.toBeNull()
      const declared = Object.keys({ ...manifest?.dependencies, ...manifest?.peerDependencies })
      expect(declared.filter((name) => name === 'react' || name === 'react-dom')).toEqual([])
    },
  )
})
