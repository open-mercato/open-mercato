// POC: measure the bytes esbuild has to bundle when each candidate package
// is *not* externalized, vs. when it is externalized (i.e. left as a runtime
// `require()`).
//
// The bundle size esbuild produces here is a tight lower-bound estimate of
// the compiled-module graph Turbopack must hold in dev RSS for the same
// server entry. Turbopack adds its own per-module overhead (ASTs, source
// maps, dependency tracking, hot-reload state) on top of this. In practice
// Turbopack server compile RSS scales roughly 3-6x the raw bundle size for
// dev (no minification, source maps, full HMR state).
//
// Usage: node bundle-size.mjs [--out=<dir>]
//
// Output: JSON report on stdout + ./bundle-size-report.json on disk.

import * as esbuild from 'esbuild'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

const APP_DIR = process.env.APP_DIR
  ?? path.resolve(fileURLToPath(import.meta.url), '../../../home/pkarw/Projects/github-janitor/.janitor/repos/open-mercato__open-mercato/worktrees/dc0e2879-9532-4e0c-851d-88ea3c807ab7/apps/mercato')

// Candidate packages to evaluate.
// Each entry: { pkg, entry, why, alreadyExternal }
const CANDIDATES = [
  { pkg: '@mikro-orm/postgresql', entry: '@mikro-orm/postgresql', why: 'PostgreSQL ORM driver — server-only' },
  { pkg: '@mikro-orm/core',       entry: '@mikro-orm/core',       why: 'MikroORM core — server-only' },
  { pkg: '@mikro-orm/migrations', entry: '@mikro-orm/migrations', why: 'Migration runner — server-only' },
  { pkg: '@mikro-orm/decorators', entry: '@mikro-orm/decorators', why: 'Entity decorators — server-only' },
  { pkg: 'pg',                    entry: 'pg',                    why: 'Native PG driver — server-only' },
  { pkg: 'bcryptjs',              entry: 'bcryptjs',              why: 'Password hashing — server-only' },
  { pkg: 'bullmq',                entry: 'bullmq',                why: 'Redis-backed queue — server-only' },
  { pkg: 'ioredis',               entry: 'ioredis',               why: 'Redis client — server-only' },
  { pkg: 'pdfjs-dist',            entry: 'pdfjs-dist',            why: 'PDF parser used in attachments OCR — server-only' },
  { pkg: '@napi-rs/canvas',       entry: '@napi-rs/canvas',       why: 'Native canvas — server-only' },
  { pkg: 'newrelic',              entry: 'newrelic',              why: 'APM agent — server-only' },
  { pkg: '@react-email/components', entry: '@react-email/components', why: 'Email rendering — server-only' },
  { pkg: 'react-email',           entry: 'react-email',           why: 'Email CLI/renderer — server-only' },
  { pkg: 'resend',                entry: 'resend',                why: 'Email send SDK — server-only' },
  { pkg: 'awilix',                entry: 'awilix',                why: 'DI container — server-only' },
  { pkg: 'ai',                    entry: 'ai',                    why: 'Vercel AI SDK — server-only handler use' },
  { pkg: '@ai-sdk/openai',        entry: '@ai-sdk/openai',        why: 'OpenAI provider — server-only' },
]

function makeEntryCode(pkg) {
  // Use both `import * as X from '<pkg>'` and a touched property to defeat
  // tree-shaking of side-effect-free re-exports.
  return `
import * as PKG from '${pkg}'
globalThis.__poc_keep__ = PKG
`
}

async function bundlePackage(pkg, { externalize }) {
  const entry = makeEntryCode(pkg)
  const result = await esbuild.build({
    stdin: {
      contents: entry,
      resolveDir: APP_DIR,
      sourcefile: 'poc-entry.mjs',
      loader: 'js',
    },
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    sourcemap: false,
    minify: false,
    logLevel: 'silent',
    nodePaths: [path.join(APP_DIR, 'node_modules')],
    external: externalize ? [pkg, `${pkg}/*`] : [],
    plugins: [],
  })
  const totalBytes = result.outputFiles.reduce((acc, f) => acc + f.contents.byteLength, 0)
  return totalBytes
}

async function safeBundle(pkg, opts) {
  try {
    return { ok: true, bytes: await bundlePackage(pkg, opts) }
  } catch (err) {
    return { ok: false, error: err.message ?? String(err) }
  }
}

async function main() {
  const rows = []
  for (const candidate of CANDIDATES) {
    const inlined = await safeBundle(candidate.entry, { externalize: false })
    const external = await safeBundle(candidate.entry, { externalize: true })
    rows.push({
      pkg: candidate.pkg,
      why: candidate.why,
      inlinedBytes: inlined.ok ? inlined.bytes : null,
      externalBytes: external.ok ? external.bytes : null,
      savedBytes: (inlined.ok && external.ok) ? inlined.bytes - external.bytes : null,
      error: inlined.ok && external.ok ? null : (inlined.error ?? external.error),
    })
  }

  const totalInlined = rows.filter((r) => r.inlinedBytes !== null).reduce((a, r) => a + r.inlinedBytes, 0)
  const totalExternal = rows.filter((r) => r.externalBytes !== null).reduce((a, r) => a + r.externalBytes, 0)
  const totalSaved = totalInlined - totalExternal

  const report = {
    appDir: APP_DIR,
    rows,
    totalInlinedBytes: totalInlined,
    totalExternalBytes: totalExternal,
    totalSavedBytes: totalSaved,
  }

  // Pretty table
  console.log('package'.padEnd(34) + '  inlined (MB)  external (MB)  saved (MB)')
  console.log('-'.repeat(34) + '  -------------  -------------  ----------')
  for (const r of rows) {
    const fmt = (b) => b === null ? '       n/a' : (b / 1024 / 1024).toFixed(2).padStart(10)
    console.log(
      r.pkg.padEnd(34)
      + '  ' + fmt(r.inlinedBytes)
      + '     ' + fmt(r.externalBytes)
      + '   ' + fmt(r.savedBytes)
      + (r.error ? `   ! ${r.error}` : '')
    )
  }
  console.log('-'.repeat(34) + '  -------------  -------------  ----------')
  console.log(
    'TOTAL'.padEnd(34)
    + '  ' + ((totalInlined / 1024 / 1024).toFixed(2)).padStart(10)
    + '     ' + ((totalExternal / 1024 / 1024).toFixed(2)).padStart(10)
    + '   ' + ((totalSaved / 1024 / 1024).toFixed(2)).padStart(10)
  )

  fs.writeFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), 'poc-bundle-size-report.json'),
    JSON.stringify(report, null, 2),
  )
}

await main()
