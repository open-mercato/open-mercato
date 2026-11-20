import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readEnabledModulesFromConfig } from '../resolver'

const entry = "{ id: 'example', overrides: { forms: { sections: { 'example.todo/default/update/details': null } } } }"
const original = process.env.NEXT_PUBLIC_OM_CUSTOM_FORM

let directory: string

function configure(source: string) {
  const filename = path.join(directory, 'modules.ts')
  fs.writeFileSync(filename, source)
  return readEnabledModulesFromConfig(filename)
}

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'crudform-gating-'))
})

afterEach(() => {
  fs.rmSync(directory, { recursive: true, force: true })
  if (original === undefined) delete process.env.NEXT_PUBLIC_OM_CUSTOM_FORM
  else process.env.NEXT_PUBLIC_OM_CUSTOM_FORM = original
})

it('accepts ungated and public-gated form section overrides', () => {
  expect(configure(`export const enabledModules = [${entry}]`).map(({ id }) => id)).toEqual(['example'])
  process.env.NEXT_PUBLIC_OM_CUSTOM_FORM = 'yes'
  expect(configure(`
    export const enabledModules = [];
    if (process.env.NEXT_PUBLIC_OM_CUSTOM_FORM) enabledModules.push(${entry});
  `).map(({ id }) => id)).toEqual(['example'])
})

it.each([
  `if (process.env.OM_PRIVATE_FORM) enabledModules.push(${entry});`,
  `if (process.env.OM_PRIVATE_FORM) enabledModules.push({id:'normal'}); else enabledModules.push(${entry});`,
  `const gated = process.env['OM_PRIVATE_FORM']; if (gated) { enabledModules.push(${entry}); }`,
  `const definition = ${entry}; if (process.env.OM_PRIVATE_FORM) enabledModules.push(definition);`,
  `process.env.OM_PRIVATE_FORM && enabledModules.push(${entry});`,
])('rejects a server-only form gate even when the branch is inactive (%s)', (branch) => {
  expect(() => configure(`export const enabledModules = []; ${branch}`)).toThrow(/forms\.sections.*OM_PRIVATE_FORM/)
})

it('rejects a gate derived from a dynamically read environment object', () => {
  expect(() => configure(`
    const { OM_PRIVATE_FORM } = process.env;
    export const enabledModules = [];
    if (OM_PRIVATE_FORM) enabledModules.push(${entry});
  `)).toThrow(/forms\.sections.*dynamic process\.env/)
})

it('leaves other override domains and legacy server-only gated modules alone', () => {
  expect(configure(`
    export const enabledModules = [{ id: 'example', overrides: {
      forms: { sections: {} },
      nav: process.env.OM_PRIVATE_FORM ? { groupOrder: [] } : undefined,
    }}];
    if (process.env.OM_PRIVATE_FORM) enabledModules.push({ id: 'normal' });
  `).map(({ id }) => id)).toEqual(['example'])
})
