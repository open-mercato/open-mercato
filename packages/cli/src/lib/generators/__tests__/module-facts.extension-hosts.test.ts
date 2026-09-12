import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { extractModuleFacts } from '../module-facts'

function findCoreSrcRoot(): string {
  let dir = __dirname
  for (let depth = 0; depth < 10; depth += 1) {
    const candidate = path.join(dir, 'packages', 'core', 'src', 'modules')
    if (fs.existsSync(candidate)) return candidate
    dir = path.dirname(dir)
  }
  throw new Error('[internal] could not locate packages/core/src/modules from the test directory')
}

function write(filePath: string, source: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, source)
}

describe('module-facts extension host extraction', () => {
  const coreSrcRoot = findCoreSrcRoot()

  it('resolves generated E.<module>.<entity> custom-field declarations from shipped modules', () => {
    const expectedByModule: Record<string, string[]> = {
      attachments: ['attachments:attachment'],
      catalog: [
        'catalog:catalog_product',
        'catalog:catalog_product_variant',
        'catalog:catalog_product_price',
      ],
      sales: [
        'sales:sales_order',
        'sales:sales_order_line',
        'sales:sales_order_adjustment',
        'sales:sales_quote',
        'sales:sales_quote_line',
        'sales:sales_quote_adjustment',
        'sales:sales_invoice',
        'sales:sales_invoice_line',
        'sales:sales_payment',
        'sales:sales_payment_allocation',
        'sales:sales_credit_memo',
        'sales:sales_credit_memo_line',
        'sales:sales_shipment',
        'sales:sales_shipment_item',
        'sales:sales_note',
      ],
      // EP-43 registered the five time-tracking entities in staff's `ce.ts`; they carry
      // no default field definitions, and `customFields` here means "declared in ce.ts",
      // not "ships fields".
      staff: [
        'staff:staff_team_member',
        'staff:staff_time_entry',
        'staff:staff_time_project',
        'staff:staff_time_report',
        'staff:staff_time_tag',
        'staff:staff_time_task',
      ],
    }

    for (const [moduleId, expected] of Object.entries(expectedByModule)) {
      const facts = extractModuleFacts({ moduleId, coreSrcRoot })
      expect(facts.entities.filter((entity) => entity.customFields).map((entity) => entity.id).sort()).toEqual(
        [...expected].sort(),
      )
    }
  })

  it('discovers literal and conditional DataTable IDs outside backend while excluding test sources', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'module-facts-extension-hosts-'))
    const moduleRoot = path.join(tmpRoot, 'alpha')
    try {
      write(
        path.join(moduleRoot, 'data', 'entities.ts'),
        `@Entity({ tableName: 'alpha_records' })\nexport class AlphaRecord { updatedAt?: Date }\n`,
      )
      write(
        path.join(moduleRoot, 'ce.ts'),
        `export const entities = [{ id: E.alpha.alpha_record, fields: [] }]\n`,
      )
      write(
        path.join(moduleRoot, 'components', 'AlphaTable.tsx'),
        `export const props = {
  perspective: { tableId: kind === 'one' ? 'alpha.one' : 'alpha.two' },
  extensionTableId: 'alpha.extension',
}\n`,
      )
      write(
        path.join(moduleRoot, 'components', 'Noise.test.tsx'),
        `export const noise = { tableId: 'alpha.test-noise' }\n`,
      )
      write(
        path.join(moduleRoot, 'backend', '__tests__', 'noise.tsx'),
        `export const noise = { extensionTableId: 'alpha.test-directory-noise' }\n`,
      )

      const facts = extractModuleFacts({ moduleId: 'alpha', moduleRoot })
      expect(facts.entities).toEqual([
        expect.objectContaining({ id: 'alpha:alpha_record', customFields: true }),
      ])
      expect(facts.hostTokens.tableIds).toEqual(['alpha.extension', 'alpha.one', 'alpha.two'])
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true })
    }
  })

  it('captures shipped component-level table hosts used by catalog and sales', () => {
    const catalog = extractModuleFacts({ moduleId: 'catalog', coreSrcRoot })
    expect(catalog.hostTokens.tableIds).toEqual([
      'catalog.categories.list',
      'catalog.products.list',
    ])

    const sales = extractModuleFacts({ moduleId: 'sales', coreSrcRoot })
    expect(sales.hostTokens.tableIds).toEqual(['sales.orders', 'sales.payments', 'sales.quotes'])
  })
})
