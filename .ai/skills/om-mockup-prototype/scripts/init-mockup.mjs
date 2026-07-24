#!/usr/bin/env node
/**
 * Tworzy nowy katalog prototypu z szablonu skilla om-mockup-prototype.
 *
 * Użycie:
 *   node .ai/skills/om-mockup-prototype/scripts/init-mockup.mjs <nazwa-modułu> [--requirements <ścieżka>]
 *
 * Przykład:
 *   node .../init-mockup.mjs time-tracking --requirements time-tracking-module-requirements.md
 *
 * Tworzy .ai/mockups/<nazwa-modułu>/ z kompletem plików i wygenerowanym tokens.css.
 * Nie nadpisuje istniejącego katalogu — świadomie, żeby nie skasować cudzych komentarzy.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { execFileSync } from 'node:child_process'

const SKILL_DIR = resolve(new URL('..', import.meta.url).pathname)
const REPO_ROOT = resolve(SKILL_DIR, '../../..')
const ASSETS = join(SKILL_DIR, 'assets')

const args = process.argv.slice(2)
const moduleName = args.find((arg) => !arg.startsWith('--'))
const reqIndex = args.indexOf('--requirements')
const requirements = reqIndex !== -1 ? args[reqIndex + 1] : '<wymagania>.md'

if (!moduleName) {
  console.error('Podaj nazwę modułu, np.: init-mockup.mjs time-tracking')
  process.exit(2)
}

const target = join(REPO_ROOT, '.ai/mockups', moduleName)

if (existsSync(target)) {
  console.error(`Katalog już istnieje: ${target}`)
  console.error('Usuń go ręcznie albo wybierz inną nazwę — nie nadpisuję, żeby nie skasować komentarzy.')
  process.exit(1)
}

mkdirSync(target, { recursive: true })

// Pliki kopiowane 1:1
for (const file of ['components.css', 'screens.css', 'prototype.css', 'prototype.js', 'comments.js']) {
  copyFileSync(join(ASSETS, file), join(target, file))
}

// index.html z podstawionymi placeholderami
const title = moduleName.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
const html = readFileSync(join(ASSETS, 'index.html'), 'utf8')
  .replaceAll('{{MODULE}}', title)
  .replaceAll('{{REQUIREMENTS}}', requirements)
writeFileSync(join(target, 'index.html'), html, 'utf8')

// tokens.css generowany ze źródła prawdy
execFileSync('node', [join(SKILL_DIR, 'scripts/sync-tokens.mjs'), target], { stdio: 'inherit' })

console.log(`\nPrototyp gotowy: .ai/mockups/${moduleName}/`)
console.log('Otwórz index.html w przeglądarce (działa przez file://).')
console.log('Kolejny krok: zbuduj sekcje .screen według references/screen-patterns.md.')
