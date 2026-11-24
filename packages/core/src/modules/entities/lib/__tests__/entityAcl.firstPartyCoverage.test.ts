/** @jest-environment node */

import fs from 'node:fs'
import path from 'node:path'
import { resolveEntityAclRequirement } from '@open-mercato/core/modules/entities/lib/entityAcl'

const REPO_ROOT = path.resolve(__dirname, '../../../../../../..')

const VIRTUAL_CUSTOM_ENTITY_IDS = new Set(['example:calendar_entity'])

function listModuleDirs(): string[] {
  const roots: string[] = []
  const packagesDir = path.join(REPO_ROOT, 'packages')
  for (const pkg of fs.readdirSync(packagesDir)) {
    const modulesDir = path.join(packagesDir, pkg, 'src', 'modules')
    if (fs.existsSync(modulesDir)) roots.push(modulesDir)
  }
  const appModulesDir = path.join(REPO_ROOT, 'apps', 'mercato', 'src', 'modules')
  if (fs.existsSync(appModulesDir)) roots.push(appModulesDir)
  const moduleDirs: string[] = []
  for (const root of roots) {
    for (const moduleName of fs.readdirSync(root)) {
      const moduleDir = path.join(root, moduleName)
      if (fs.statSync(moduleDir).isDirectory()) moduleDirs.push(moduleDir)
    }
  }
  return moduleDirs
}

function resolveConstantReference(moduleDir: string, constantName: string, key: string): string | null {
  const stack = [moduleDir]
  while (stack.length > 0) {
    const current = stack.pop() as string
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name)
      if (entry.isDirectory()) {
        if (entry.name !== '__tests__' && entry.name !== 'node_modules') stack.push(entryPath)
        continue
      }
      if (!entry.name.endsWith('.ts')) continue
      const source = fs.readFileSync(entryPath, 'utf8')
      const declaration = source.match(new RegExp(`export const ${constantName}\\s*=\\s*\\{([\\s\\S]*?)\\}`))
      if (!declaration) continue
      const property = declaration[1].match(new RegExp(`\\b${key}\\s*:\\s*'([^']+)'`))
      if (property) return property[1]
    }
  }
  return null
}

function collectDeclaredEntityIds(): { ids: string[]; unresolved: string[] } {
  const ids: string[] = []
  const unresolved: string[] = []
  for (const moduleDir of listModuleDirs()) {
    const cePath = path.join(moduleDir, 'ce.ts')
    if (!fs.existsSync(cePath)) continue
    const source = fs.readFileSync(cePath, 'utf8')
    const pattern = /^\s*id:\s*(?:'([^']+)'|E\.(\w+)\.(\w+)|([A-Z][A-Z0-9_]*)\.(\w+))\s*,/gm
    for (const match of source.matchAll(pattern)) {
      if (match[1]) ids.push(match[1])
      else if (match[2] && match[3]) ids.push(`${match[2]}:${match[3]}`)
      else if (match[4] && match[5]) {
        const resolved = resolveConstantReference(moduleDir, match[4], match[5])
        if (resolved) ids.push(resolved)
        else unresolved.push(`${cePath}: ${match[4]}.${match[5]}`)
      }
    }
  }
  return { ids: Array.from(new Set(ids)).sort(), unresolved }
}

function findModuleAclSource(moduleId: string): string | null {
  for (const moduleDir of listModuleDirs()) {
    if (path.basename(moduleDir) !== moduleId) continue
    const aclPath = path.join(moduleDir, 'acl.ts')
    if (fs.existsSync(aclPath)) return fs.readFileSync(aclPath, 'utf8')
  }
  return null
}

describe('ENTITY_ACL_REQUIREMENTS first-party coverage', () => {
  const { ids, unresolved } = collectDeclaredEntityIds()
  const systemEntityIds = ids.filter((id) => !VIRTUAL_CUSTOM_ENTITY_IDS.has(id))

  test('discovers the first-party ce.ts declarations', () => {
    expect(unresolved).toEqual([])
    expect(systemEntityIds).toEqual(expect.arrayContaining([
      'catalog:catalog_product_variant',
      'example:todo',
      'wms:warehouse',
      'staff:staff_time_entry',
      'sales:sales_order_line',
      'warranty_claims:warranty_claim',
      'eudr:eudr_plot',
      'customers:customer_deal',
      'customer_accounts:customer_user',
      'attachments:attachment',
      'inbox_ops:inbox_proposal',
      'checkout:checkout_transaction',
    ]))
  })

  test('every system entity declared in a first-party ce.ts has an ACL requirement', () => {
    const missing = systemEntityIds.filter((id) => resolveEntityAclRequirement(id) === null)
    expect(missing).toEqual([])
  })

  test('no first-party ce.ts entity is platform-only', () => {
    const platformOnly = systemEntityIds.filter((id) => resolveEntityAclRequirement(id)?.platformOnly)
    expect(platformOnly).toEqual([])
  })

  test('every required feature is declared in its module acl.ts', () => {
    const undeclared: string[] = []
    for (const id of systemEntityIds) {
      const requirement = resolveEntityAclRequirement(id)
      if (!requirement) continue
      for (const feature of [...requirement.view, ...requirement.manage]) {
        const moduleId = feature.split('.')[0]
        const aclSource = findModuleAclSource(moduleId)
        if (!aclSource || !aclSource.includes(`'${feature}'`)) undeclared.push(`${id} -> ${feature}`)
      }
    }
    expect(undeclared).toEqual([])
  })

  test.each([
    ['catalog:catalog_product_variant', ['catalog.products.view'], ['catalog.variants.manage']],
    ['example:todo', ['example.todos.view'], ['example.todos.manage']],
    ['wms:asn', ['wms.view'], ['wms.manage_asn']],
    ['staff:staff_time_entry', ['staff.timesheets.view'], ['staff.timesheets.manage_own']],
    ['sales:sales_order_line', ['sales.orders.view'], ['sales.orders.manage']],
    ['sales:sales_invoice', ['sales.invoices.manage'], ['sales.invoices.manage']],
    ['warranty_claims:warranty_claim_registration', ['warranty_claims.registration.view'], ['warranty_claims.registration.manage']],
    ['eudr:eudr_mitigation_action', ['eudr.risk.view'], ['eudr.risk.manage']],
    ['customer_accounts:customer_role', ['customer_accounts.view'], ['customer_accounts.roles.manage']],
    ['attachments:attachment', ['attachments.view'], ['attachments.manage']],
    ['inbox_ops:inbox_proposal', ['inbox_ops.proposals.view'], ['inbox_ops.proposals.manage']],
  ])('maps %s to its route features', (entityId, view, manage) => {
    expect(resolveEntityAclRequirement(entityId)).toEqual({ view, manage })
  })
})
