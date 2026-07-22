#!/usr/bin/env node
/**
 * Generuje tokens.css dla mockupu na podstawie apps/mercato/src/app/globals.css.
 *
 * Mockupy są statycznym HTML-em, więc nie mogą importować Tailwinda — token muszą
 * być skopiowane. Kopiowanie ręczne cicho się rozjeżdża przy każdej zmianie
 * design systemu, dlatego ten skrypt jest jedynym sposobem na wygenerowanie
 * tokens.css. Uruchamiaj go ponownie, gdy globals.css się zmieni.
 *
 * Użycie:
 *   node .ai/skills/om-mockup-prototype/scripts/sync-tokens.mjs <katalog-mockupu>
 *   node .ai/skills/om-mockup-prototype/scripts/sync-tokens.mjs --check <katalog-mockupu>
 *
 * --check nic nie zapisuje, tylko zwraca kod 1, gdy plik jest nieaktualny.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'

const REPO_ROOT = resolve(new URL('../../../..', import.meta.url).pathname)
const GLOBALS = join(REPO_ROOT, 'apps/mercato/src/app/globals.css')

/** Prefiksy z @theme inline, które mockup faktycznie wykorzystuje. */
const THEME_PREFIXES = ['--shadow-', '--z-index-', '--radius-', '--font-size-']

/**
 * Komentarze trzeba usunąć PRZED szukaniem klamr — globals.css zawiera w komentarzu
 * `state/{x}/base`, którego klamra inaczej zamyka blok w połowie i cicho ucina
 * połowę tokenów statusowych.
 */
function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

/**
 * Szuka bloku po selektorze stojącym NA POCZĄTKU LINII i zakończonym `{`.
 *
 * Zwykłe indexOf(selektor) nie wystarcza: globals.css zawiera
 * `@custom-variant dark (&:is(.dark *));`, więc szukanie ".dark" trafiało
 * w tę linię i zwracało cudzy blok — tokeny ciemnego motywu wychodziły puste.
 */
function block(css, opener) {
  const escaped = opener.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{`).exec(css)
  if (!match) throw new Error(`Nie znaleziono bloku "${opener}" w globals.css`)
  const open = match.index + match[0].length - 1

  let depth = 0
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1
    else if (css[i] === '}') {
      depth -= 1
      if (depth === 0) return css.slice(open + 1, i)
    }
  }
  throw new Error(`Niedomknięty blok "${opener}"`)
}

/** Zwraca [{name, value}] — puste linie odrzucone. */
function declarations(body) {
  return body
    .split(';')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('--'))
    .map((line) => {
      const at = line.indexOf(':')
      return { name: line.slice(0, at).trim(), value: line.slice(at + 1).trim() }
    })
}

function emit(decls, indent = '  ') {
  return decls.map((d) => `${indent}${d.name}: ${d.value};`).join('\n')
}

function build() {
  const css = stripComments(readFileSync(GLOBALS, 'utf8'))

  const root = declarations(block(css, ':root'))
  const dark = declarations(block(css, '.dark'))
  const theme = declarations(block(css, '@theme inline')).filter((d) =>
    THEME_PREFIXES.some((prefix) => d.name.startsWith(prefix)),
  )

  // @theme inline mapuje --color-x na var(--x); mockup używa surowych tokenów,
  // więc te aliasy są zbędne — zostawiamy tylko skale (cień, z-index, promień, typografia).
  const scales = theme.filter((d) => !d.value.startsWith('var(--color'))

  // Bezpiecznik: cicho pusty blok już raz przeszedł niezauważony (selektor .dark
  // trafiał w @custom-variant). Lepiej wywalić się głośno niż wygenerować
  // prototyp bez ciemnego motywu albo bez kolorów statusów.
  const expect = [
    ['(:root)', root, 60],
    ['(.dark)', dark, 40],
    ['(@theme inline)', scales, 15],
  ]
  for (const [label, list, min] of expect) {
    if (list.length < min) {
      throw new Error(
        `Blok ${label} dał tylko ${list.length} tokenów (oczekiwano min. ${min}). ` +
          'Prawdopodobnie zmienił się układ globals.css i parser trafił w niewłaściwy blok.',
      )
    }
  }
  if (!root.some((d) => d.name === '--status-error-bg')) {
    throw new Error('Brak --status-error-bg w :root — tokeny statusów nie zostały odczytane.')
  }
  if (!dark.some((d) => d.name === '--background')) {
    throw new Error('Brak --background w .dark — tokeny ciemnego motywu nie zostały odczytane.')
  }

  return [
    '/* WYGENEROWANE — nie edytuj ręcznie.',
    ' *',
    ' * Źródło: apps/mercato/src/app/globals.css',
    ' * Regeneracja: node .ai/skills/om-mockup-prototype/scripts/sync-tokens.mjs <katalog>',
    ' *',
    ' * Mockup jest statycznym HTML-em bez Tailwinda, więc tokeny muszą być skopiowane.',
    ' * Ten plik jest kopią — jeśli design system się zmienił, uruchom skrypt ponownie.',
    ' */',
    '',
    ':root {',
    '  color-scheme: light;',
    emit(root),
    '',
    emit(scales),
    '}',
    '',
    '.dark {',
    '  color-scheme: dark;',
    emit(dark),
    '}',
    '',
  ].join('\n')
}

const args = process.argv.slice(2)
const checkOnly = args.includes('--check')
const target = args.find((arg) => !arg.startsWith('--'))

if (!target) {
  console.error('Podaj katalog mockupu, np.: sync-tokens.mjs .ai/mockups/time-tracking')
  process.exit(2)
}

const outPath = join(resolve(target), 'tokens.css')
const next = build()

if (checkOnly) {
  const current = existsSync(outPath) ? readFileSync(outPath, 'utf8') : ''
  if (current !== next) {
    console.error(`tokens.css jest nieaktualny wobec globals.css → ${outPath}`)
    console.error('Uruchom sync-tokens.mjs bez --check, żeby zregenerować.')
    process.exit(1)
  }
  console.log('tokens.css aktualny.')
  process.exit(0)
}

writeFileSync(outPath, next, 'utf8')
const count = (next.match(/^\s+--/gm) || []).length
console.log(`Zapisano ${outPath} (${count} tokenów).`)
