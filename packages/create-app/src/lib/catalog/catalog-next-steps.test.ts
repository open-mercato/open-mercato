import assert from 'node:assert/strict'
import test from 'node:test'
import { printCatalogNextSteps } from '../../index.ts'

const SHIPMENT = 'yarn mercato module add @freighttech/shipment-tracking@0.7.2 --allow-third-party'
const STRIPE = 'yarn mercato module add @open-mercato/gateway-stripe@0.9.0'
const WARNING = 'Adds the backend route /backend/webhooks, which a new app on 0.8 already has from the webhooks module (@open-mercato/webhooks). The generate step refuses two modules with one backend route.'

function captured(print: () => void): string[] {
  const output: string[] = []
  const originalLog = console.log
  console.log = (...args: unknown[]) => {
    output.push(args.map((arg) => String(arg)).join(' ').replace(/\u001b\[[0-9;]*m/g, ''))
  }
  try {
    print()
  } finally {
    console.log = originalLog
  }
  return output
}

test('printCatalogNextSteps puts the catalog warning right above its command', () => {
  const output = captured(() => printCatalogNextSteps([STRIPE, SHIPMENT], { [SHIPMENT]: WARNING }))
  const command = output.indexOf(`  ${SHIPMENT}`)
  assert.ok(command > 0)
  assert.equal(output[command - 1], `  # Warning: ${WARNING}`)
  assert.equal(output.filter((line) => line.includes('# Warning:')).length, 1)
})

test('printCatalogNextSteps prints no warning line for commands without one', () => {
  const output = captured(() => printCatalogNextSteps([STRIPE]))
  assert.ok(output.includes(`  ${STRIPE}`))
  assert.ok(!output.some((line) => line.includes('Warning')))
  assert.deepEqual(captured(() => printCatalogNextSteps([])), [])
})

test('printCatalogNextSteps ignores prototype keys and inherited warnings', () => {
  const warnings: Record<string, string> = Object.create({ [SHIPMENT]: 'inherited warning' })
  const output = captured(() => printCatalogNextSteps(['constructor', '__proto__', 'toString', SHIPMENT], warnings))
  assert.ok(!output.some((line) => line.includes('# Warning:')))
  assert.ok(output.includes(`  ${SHIPMENT}`))
})

test('printCatalogNextSteps accepts own warnings named like prototype properties', () => {
  const commands = ['constructor', '__proto__', 'toString']
  const warnings = Object.fromEntries(commands.map((command) => [command, WARNING]))
  const output = captured(() => printCatalogNextSteps(commands, warnings))
  for (const command of commands) {
    assert.equal(output[output.indexOf(`  ${command}`) - 1], `  # Warning: ${WARNING}`)
  }
})
