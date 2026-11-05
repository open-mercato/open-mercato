#!/usr/bin/env node
import { existsSync, lstatSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const SKILL_DIR = resolve(SCRIPT_DIR, '..')
const REPO_ROOT = resolve(SKILL_DIR, '../../..')
const PROTOTYPES_ROOT = join(REPO_ROOT, '.ai/prototypes')
const GLOBALS_PATH = join(REPO_ROOT, 'apps/mercato/src/app/globals.css')
const ASSETS_DIR = join(SKILL_DIR, 'assets')
const THEME_PREFIXES = ['--shadow-', '--z-index-', '--radius-', '--font-size-']
const BUNDLED_STYLESHEETS = ['components.css', 'screens.css', 'prototype.css']
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

function readBlock(css, opener) {
  const escapedOpener = opener.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`(?:^|\\n)\\s*${escapedOpener}\\s*\\{`).exec(css)
  if (!match) throw new Error(`Could not find the ${opener} block in globals.css.`)
  const openingBrace = match.index + match[0].length - 1

  let depth = 0
  for (let index = openingBrace; index < css.length; index += 1) {
    if (css[index] === '{') depth += 1
    if (css[index] === '}') {
      depth -= 1
      if (depth === 0) return css.slice(openingBrace + 1, index)
    }
  }
  throw new Error(`The ${opener} block in globals.css is not closed.`)
}

function parseDeclarations(body) {
  return body
    .split(';')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('--'))
    .map((line) => {
      const separator = line.indexOf(':')
      return { name: line.slice(0, separator).trim(), value: line.slice(separator + 1).trim() }
    })
}

function emitDeclarations(declarations, indent = '  ') {
  return declarations.map((declaration) => `${indent}${declaration.name}: ${declaration.value};`).join('\n')
}

function assertTokenGroup(label, declarations, minimum) {
  if (declarations.length < minimum) {
    throw new Error(
      `${label} produced ${declarations.length} tokens; expected at least ${minimum}. ` +
        'The globals.css structure may have changed.',
    )
  }
}

export function assertBundledVariablesResolve(generatedCss, assetsDirectory = ASSETS_DIR) {
  const bundledCss = BUNDLED_STYLESHEETS
    .map((filename) => readFileSync(join(assetsDirectory, filename), 'utf8'))
    .join('\n')
  const defined = new Set()
  const definitionPattern = /(--[A-Za-z0-9_-]+)\s*:/g
  for (const css of [generatedCss, bundledCss]) {
    for (const match of css.matchAll(definitionPattern)) defined.add(match[1])
  }

  const unresolved = new Set()
  for (const match of bundledCss.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)([^)]*)\)/g)) {
    const hasFallback = match[2].trimStart().startsWith(',')
    if (!hasFallback && !defined.has(match[1])) unresolved.add(match[1])
  }
  if (unresolved.size) {
    throw new Error(`Bundled styles reference undefined CSS variables: ${Array.from(unresolved).sort().join(', ')}`)
  }
}

export function buildTokens(globalsPath = GLOBALS_PATH, assetsDirectory = ASSETS_DIR) {
  const css = stripComments(readFileSync(globalsPath, 'utf8'))
  const root = parseDeclarations(readBlock(css, ':root'))
  const dark = parseDeclarations(readBlock(css, '.dark'))
  const scales = parseDeclarations(readBlock(css, '@theme inline')).filter((declaration) =>
    THEME_PREFIXES.some((prefix) => declaration.name.startsWith(prefix)),
  )

  assertTokenGroup(':root', root, 60)
  assertTokenGroup('.dark', dark, 40)
  assertTokenGroup('@theme inline', scales, 15)
  if (!root.some((declaration) => declaration.name === '--status-error-bg')) {
    throw new Error('The :root block does not define --status-error-bg.')
  }
  if (!dark.some((declaration) => declaration.name === '--background')) {
    throw new Error('The .dark block does not define --background.')
  }

  const generated = [
    '/* GENERATED — do not edit by hand.',
    ' * Source: apps/mercato/src/app/globals.css',
    ' * Regenerate with .ai/skills/om-mockup-prototype/scripts/sync-tokens.mjs.',
    ' */',
    '',
    ':root {',
    '  color-scheme: light;',
    emitDeclarations(root),
    '',
    emitDeclarations(scales),
    '}',
    '',
    '.dark {',
    '  color-scheme: dark;',
    emitDeclarations(dark),
    '}',
    '',
  ].join('\n')
  assertBundledVariablesResolve(generated, assetsDirectory)
  return generated
}

export function parseSyncArguments(args) {
  if (args.length === 1 && !args[0].startsWith('--')) return { checkOnly: false, target: args[0] }
  if (args.length === 2 && args[0] === '--check' && !args[1].startsWith('--')) {
    return { checkOnly: true, target: args[1] }
  }
  throw new Error('Usage: sync-tokens.mjs [--check] .ai/prototypes/<prototype-slug>')
}

export function resolvePrototypeTarget(targetArgument) {
  const target = resolve(targetArgument)
  const targetRelative = relative(PROTOTYPES_ROOT, target)
  if (
    !targetRelative ||
    targetRelative.startsWith('..') ||
    isAbsolute(targetRelative) ||
    targetRelative.includes('/') ||
    targetRelative.includes('\\') ||
    !SLUG_PATTERN.test(targetRelative)
  ) {
    throw new Error('Target must be an immediate .ai/prototypes/<prototype-slug> directory.')
  }
  if (!existsSync(target) || !statSync(target).isDirectory()) {
    throw new Error(`Prototype directory does not exist: ${targetArgument}`)
  }
  if (lstatSync(target).isSymbolicLink()) {
    throw new Error('Prototype target must not be a symbolic link.')
  }
  const prototypesRoot = realpathSync(PROTOTYPES_ROOT)
  const resolvedTarget = realpathSync(target)
  const resolvedRelative = relative(prototypesRoot, resolvedTarget)
  if (!resolvedRelative || resolvedRelative.startsWith('..') || isAbsolute(resolvedRelative)) {
    throw new Error('Prototype target resolves outside .ai/prototypes.')
  }
  return resolvedTarget
}

function main() {
  try {
    const { checkOnly, target: targetArgument } = parseSyncArguments(process.argv.slice(2))
    const target = resolvePrototypeTarget(targetArgument)
    const outputPath = join(target, 'tokens.css')
    const generated = buildTokens()

    if (checkOnly) {
      const current = existsSync(outputPath) ? readFileSync(outputPath, 'utf8') : ''
      if (current !== generated) throw new Error(`tokens.css is out of date: ${outputPath}`)
      console.log('tokens.css is current.')
      return
    }

    writeFileSync(outputPath, generated, 'utf8')
    const count = (generated.match(/^\s+--/gm) || []).length
    console.log(`Wrote ${outputPath} (${count} tokens).`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 2
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
