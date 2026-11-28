import fs from 'node:fs'
import path from 'node:path'

import { metadata } from '../index'

const MODULE_ROOT = path.resolve(__dirname, '..')
const IMPORTS_CUSTOMER_GROUPS = /@open-mercato\/core\/modules\/customer_groups|modules\/customer_groups\//
const RESOLVES_CUSTOMER_GROUPS_SERVICE = /resolve(?:<[^>]*>)?\(\s*['"]customerGroups?[A-Za-z]*['"]/

function collectSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'migrations' || entry.name === '__tests__') continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      collectSourceFiles(full, acc)
      continue
    }
    if (/\.tsx?$/.test(entry.name)) acc.push(full)
  }
  return acc
}

describe('cart does not depend on customer_groups', () => {
  it('does not declare customer_groups as a required module', () => {
    expect(metadata.requires ?? []).not.toContain('customer_groups')
  })

  it('still declares its real dependencies', () => {
    expect(metadata.requires).toEqual(['catalog', 'sales', 'promotions'])
  })

  it('neither imports the customer_groups module nor resolves its services', () => {
    const offenders = collectSourceFiles(MODULE_ROOT)
      .filter((file) => {
        const source = fs.readFileSync(file, 'utf8')
        return IMPORTS_CUSTOMER_GROUPS.test(source) || RESOLVES_CUSTOMER_GROUPS_SERVICE.test(source)
      })
      .map((file) => path.relative(MODULE_ROOT, file))

    expect(offenders).toEqual([])
  })
})
