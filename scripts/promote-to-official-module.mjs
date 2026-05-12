#!/usr/bin/env node
// Promote a module developed inside this repo into the external/official-modules submodule.
//
// Usage:
//   yarn official-modules promote <module-id> [--as=<kebab-name>] [--apply]
//                                 [--keep-source] [--committed]
//
// Default is a DRY RUN — it prints the plan plus the manual follow-ups and changes
// nothing. Pass --apply to perform the mechanical parts (scaffold/copy the package,
// git-rm the source, drop the registry entry, activate it). It never commits and never
// pushes; it prints exactly what to commit in each repo.
//
// Supported sources:
//   - app module:        apps/mercato/src/modules/<id>/        (a package wrapper is scaffolded)
//   - dedicated package:  packages/<pkg>/ that contains only src/modules/<id>  (moved whole)
// Extracting a module out of @open-mercato/core (or shared/ui/cli) is intentionally not
// automated — do that by hand.

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

import {
  repoRoot,
  readConfig,
  writeConfig,
  writeLocalActivated,
  packageName as toPackageName,
} from './lib/official-modules.mjs'

const IGNORED_COPY_ENTRIES = new Set(['node_modules', 'dist', '.turbo', 'generated', '.next', 'coverage', '.tsbuild'])
const TEMPLATE_FILES = ['package.json', 'build.mjs', 'watch.mjs', 'tsconfig.json', 'jest.config.cjs']
const NON_PROMOTABLE_PACKAGES = new Set(['core', 'shared', 'ui', 'cli'])

function out(message = '') {
  process.stdout.write(`${message}\n`)
}
function fail(message) {
  out(`error: ${message}`)
  process.exit(1)
}
function rel(absPath) {
  return path.relative(repoRoot, absPath) || '.'
}
function git(args) {
  return execFileSync('git', args, { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim()
}
function gitMaybe(args) {
  try {
    return git(args)
  } catch {
    return ''
  }
}
function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (IGNORED_COPY_ENTRIES.has(entry.name)) continue
    const from = path.join(src, entry.name)
    const to = path.join(dest, entry.name)
    if (entry.isSymbolicLink()) continue
    if (entry.isDirectory()) copyDir(from, to)
    else fs.copyFileSync(from, to)
  }
}

// ── arguments ────────────────────────────────────────────────────────────────
const rawArgs = process.argv.slice(2)
const boolFlags = new Set(rawArgs.filter((arg) => arg.startsWith('--') && !arg.includes('=')))
const namedFlags = Object.fromEntries(
  rawArgs
    .filter((arg) => arg.startsWith('--') && arg.includes('='))
    .map((arg) => {
      const eq = arg.indexOf('=')
      return [arg.slice(2, eq), arg.slice(eq + 1)]
    }),
)
const moduleId = rawArgs.find((arg) => !arg.startsWith('--'))
if (!moduleId) {
  fail('usage: yarn official-modules promote <module-id> [--as=<name>] [--apply] [--keep-source] [--committed]')
}
const apply = boolFlags.has('--apply')
const keepSource = boolFlags.has('--keep-source')
const useCommitted = boolFlags.has('--committed')

// ── locate the source ────────────────────────────────────────────────────────
function detectSource() {
  const appModuleDir = path.join(repoRoot, 'apps', 'mercato', 'src', 'modules', moduleId)
  if (fs.existsSync(appModuleDir)) {
    return { kind: 'app', moduleDir: appModuleDir }
  }
  const packagesDir = path.join(repoRoot, 'packages')
  for (const entry of fs.readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const modulesDir = path.join(packagesDir, entry.name, 'src', 'modules')
    if (!fs.existsSync(modulesDir)) continue
    const modules = fs
      .readdirSync(modulesDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
    if (!modules.includes(moduleId)) continue
    if (NON_PROMOTABLE_PACKAGES.has(entry.name)) {
      fail(`module "${moduleId}" lives in @open-mercato/${entry.name}; extracting it is not automated — move it by hand.`)
    }
    if (modules.length > 1) {
      fail(`package @open-mercato/${entry.name} contains multiple modules (${modules.join(', ')}); promote it manually so the others aren't moved.`)
    }
    const pkgJsonPath = path.join(packagesDir, entry.name, 'package.json')
    const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'))
    return {
      kind: 'package',
      packageDir: path.join(packagesDir, entry.name),
      packageDirName: entry.name,
      moduleDir: path.join(modulesDir, moduleId),
      packageJsonName: pkgJson.name,
    }
  }
  fail(`module "${moduleId}" not found under apps/mercato/src/modules/ or packages/*/src/modules/`)
}

const source = detectSource()
const config = readConfig()
const submodulePackagesDir = path.join(repoRoot, config.path, 'packages')
if (!fs.existsSync(submodulePackagesDir)) {
  fail(`submodule not checked out at ${config.path} — run \`yarn official-modules sync\` first.`)
}

const packageSuffix =
  namedFlags.as ||
  (source.kind === 'package' ? source.packageJsonName.replace(/^@open-mercato\//, '') : moduleId.replace(/_/g, '-'))
const targetPackageName = toPackageName(packageSuffix)
const targetDir = path.join(submodulePackagesDir, packageSuffix)
if (fs.existsSync(targetDir)) {
  fail(`target already exists: ${rel(targetDir)} — pick another name with --as=<name> or remove it first.`)
}
const templateDir = path.join(submodulePackagesDir, 'test-package')

// ── plan ─────────────────────────────────────────────────────────────────────
const sourceLabel =
  source.kind === 'app'
    ? `app module at ${rel(source.moduleDir)}/`
    : `package ${source.packageJsonName} at ${rel(source.packageDir)}/`

out('')
out(`Promote module "${moduleId}" -> ${targetPackageName}`)
out(`  target:  ${rel(targetDir)}/`)
out(`  source:  ${sourceLabel}`)
out('')
out('Mechanical steps (run with --apply):')
let stepNo = 1
if (source.kind === 'app') {
  out(`  ${stepNo++}. scaffold package wrapper from ${rel(templateDir)} (package.json -> name ${targetPackageName}, version 0.0.0; build.mjs, watch.mjs, tsconfig.json, jest.config.cjs)`)
  out(`  ${stepNo++}. copy ${rel(source.moduleDir)}/ -> ${rel(targetDir)}/src/modules/${moduleId}/  (skips node_modules/dist/generated/.turbo)`)
  out(`  ${stepNo++}. write ${rel(targetDir)}/src/index.ts -> export { metadata } from './modules/${moduleId}/index'`)
} else {
  out(`  ${stepNo++}. copy ${rel(source.packageDir)}/ -> ${rel(targetDir)}/  (skips node_modules/dist/generated/.turbo; keeps existing package.json)`)
}
out(`  ${stepNo++}. ${keepSource ? '(skipped, --keep-source) ' : ''}git rm -r ${source.kind === 'app' ? rel(source.moduleDir) : rel(source.packageDir)}`)
if (source.kind === 'package') {
  out(`  ${stepNo++}. remove "${source.packageJsonName}" from apps/mercato/package.json dependencies (other package.json files: review manually)`)
}
out(`  ${stepNo++}. remove the { id: '${moduleId}', ... } entry from apps/mercato/src/modules.ts`)
out(`  ${stepNo++}. activate "${packageSuffix}" in official-modules.${useCommitted ? 'json' : 'local.json'} and regenerate official-modules.generated.ts`)
out('')
out('Then, manually:')
out('  - yarn install                                   # link the new workspace, drop the old one')
out('  - yarn generate')
out('  - yarn mercato configs cache structural --all-tenants')
out(`  - review ${rel(targetDir)}/package.json deps & peerDependencies (pin @open-mercato/core etc.)`)
out(`  - review migrations under ${rel(targetDir)}/src/modules/${moduleId}/migrations/ — official packages own their own migration set`)
out('  - fix any remaining references listed below')
out(`  - in ${config.path}: git checkout -b feat/${packageSuffix} && yarn changeset && git add packages/${packageSuffix} .changeset && git commit && git push && gh pr create --base develop`)
out('  - in open-mercato: commit the removal + modules.ts + official-modules.* changes (do NOT commit the submodule pointer bump unless intended)')
out('')

const refPatterns = [`modules/${moduleId}`]
if (source.kind === 'package') refPatterns.push(source.packageJsonName)
const excludeFromRefs = [rel(source.kind === 'app' ? source.moduleDir : source.packageDir)]
const refs = new Set()
for (const pattern of refPatterns) {
  const result = gitMaybe(['grep', '-l', '--fixed-strings', pattern, '--', 'apps', 'packages'])
  for (const line of result.split('\n').filter(Boolean)) {
    if (excludeFromRefs.some((prefix) => line === prefix || line.startsWith(`${prefix}/`))) continue
    refs.add(line)
  }
}
if (refs.size > 0) {
  out(`References to review (grep: ${refPatterns.join(', ')}):`)
  for (const file of [...refs].sort()) out(`  ${file}`)
} else {
  out(`References to review: none found for ${refPatterns.join(', ')}`)
}
out('')

if (!apply) {
  out('Dry run — pass --apply to perform the mechanical steps.')
  process.exit(0)
}

// ── apply ────────────────────────────────────────────────────────────────────
out('Applying...')

if (source.kind === 'app') {
  if (!fs.existsSync(templateDir)) fail(`template package not found: ${rel(templateDir)}`)
  fs.mkdirSync(targetDir, { recursive: true })
  for (const file of TEMPLATE_FILES) {
    const from = path.join(templateDir, file)
    if (fs.existsSync(from)) fs.copyFileSync(from, path.join(targetDir, file))
  }
  const pkgPath = path.join(targetDir, 'package.json')
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
  pkg.name = targetPackageName
  pkg.version = '0.0.0'
  fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`)
  copyDir(source.moduleDir, path.join(targetDir, 'src', 'modules', moduleId))
  const indexPath = path.join(targetDir, 'src', 'index.ts')
  if (!fs.existsSync(indexPath)) {
    fs.mkdirSync(path.dirname(indexPath), { recursive: true })
    fs.writeFileSync(indexPath, `export { metadata } from './modules/${moduleId}/index'\n`)
  }
  out(`  scaffolded ${rel(targetDir)}/ and copied module source`)
} else {
  copyDir(source.packageDir, targetDir)
  out(`  copied ${rel(source.packageDir)}/ -> ${rel(targetDir)}/`)
}

// Remove the source from this repo.
if (!keepSource) {
  const removePath = source.kind === 'app' ? source.moduleDir : source.packageDir
  try {
    git(['rm', '-r', '--quiet', rel(removePath)])
  } catch {
    fs.rmSync(removePath, { recursive: true, force: true })
  }
  out(`  removed ${rel(removePath)}`)
}

// Drop the dependency from apps/mercato/package.json for a moved package.
if (source.kind === 'package') {
  const appPkgPath = path.join(repoRoot, 'apps', 'mercato', 'package.json')
  const appPkg = JSON.parse(fs.readFileSync(appPkgPath, 'utf8'))
  let changed = false
  for (const section of ['dependencies', 'devDependencies', 'peerDependencies']) {
    if (appPkg[section] && appPkg[section][source.packageJsonName]) {
      delete appPkg[section][source.packageJsonName]
      changed = true
    }
  }
  if (changed) {
    fs.writeFileSync(appPkgPath, `${JSON.stringify(appPkg, null, 2)}\n`)
    out(`  removed ${source.packageJsonName} from apps/mercato/package.json`)
  }
}

// Remove the registry entry from apps/mercato/src/modules.ts.
{
  const modulesTsPath = path.join(repoRoot, 'apps', 'mercato', 'src', 'modules.ts')
  const lines = fs.readFileSync(modulesTsPath, 'utf8').split('\n')
  const entryRe = new RegExp(`\\bid:\\s*['"]${moduleId}['"]`)
  const kept = lines.filter((line) => !(entryRe.test(line) && /\bfrom:\s*['"]/.test(line)))
  if (kept.length !== lines.length) {
    fs.writeFileSync(modulesTsPath, kept.join('\n'))
    out(`  removed { id: '${moduleId}', ... } from apps/mercato/src/modules.ts`)
  } else {
    out(`  note: no { id: '${moduleId}', from: ... } line found in modules.ts — remove the entry by hand if needed`)
  }
}

// Activate it.
if (useCommitted) writeConfig({ activated: [...new Set([...config.activatedBase, packageSuffix])] })
else writeLocalActivated([...new Set([...config.activatedLocal, packageSuffix])])
out(`  activated "${packageSuffix}" in official-modules.${useCommitted ? 'json' : 'local.json'}`)

execFileSync(process.execPath, [path.join(repoRoot, 'scripts', 'official-modules-setup.mjs')], {
  cwd: repoRoot,
  stdio: 'inherit',
})

out('')
out('Done with the mechanical parts. Now run the manual follow-ups listed above.')
