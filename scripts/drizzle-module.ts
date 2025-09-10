#!/usr/bin/env tsx
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

type Command = 'generate' | 'migrate' | 'studio'

function usage() {
  console.log('Usage: npm run db:<cmd>:module -- <module>')
  console.log('  <cmd>: generate | migrate | studio')
  console.log('Examples:')
  console.log('  npm run db:generate:module -- auth')
  console.log('  npm run db:migrate:module -- example')
}

function ensureTempConfig(moduleId: string) {
  const tmpDir = path.resolve('.drizzle')
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir)
  const cfgPath = path.join(tmpDir, `module.${moduleId}.config.ts`)
  const schemaPath = path.resolve(`src/modules/${moduleId}/db/schema.ts`)
  if (!fs.existsSync(schemaPath)) {
    console.error(`Schema not found: ${path.relative(process.cwd(), schemaPath)}`)
    process.exit(1)
  }
  const outDir = path.resolve(`src/modules/${moduleId}/drizzle`)
  const content = `import 'dotenv/config'\nimport type { Config } from 'drizzle-kit'\n\nexport default {\n  schema: '${path.relative(path.dirname(cfgPath), schemaPath)}',\n  out: '${path.relative(path.dirname(cfgPath), outDir)}',\n  dialect: 'postgresql',\n  dbCredentials: { url: process.env.DATABASE_URL as string },\n  verbose: true,\n  strict: true,\n} satisfies Config\n`
  fs.writeFileSync(cfgPath, content)
  return cfgPath
}

function run(cmd: Command, cfgPath: string) {
  const bin = path.resolve('node_modules/.bin/drizzle-kit')
  const args = [cmd, '--config', cfgPath]
  const res = spawnSync(bin, args, { stdio: 'inherit' })
  if (res.error || res.status !== 0) {
    console.error('drizzle-kit command failed')
    process.exit(res.status || 1)
  }
}

async function main() {
  const [, , rawCmd, , moduleId] = process.argv
  const cmd = (rawCmd?.split(':')[1] as Command) || (rawCmd as Command)
  const mod = moduleId || process.argv.slice(2).find((s) => !s.startsWith('-'))
  if (!cmd || !mod) {
    usage()
    process.exit(1)
  }
  if (!['generate', 'migrate', 'studio'].includes(cmd)) {
    console.error(`Unknown command '${cmd}'`)
    usage()
    process.exit(1)
  }
  const cfg = ensureTempConfig(mod)
  run(cmd, cfg)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

