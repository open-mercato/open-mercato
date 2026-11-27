import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { REPO_ROOT } from './paths.mjs'
import { runProcess } from './exec.mjs'

export function parseModuleIds(modulesSource) {
  const ids = new Set()
  const pattern = /\{\s*id:\s*['"]([a-z0-9_]+)['"]/g
  let match = pattern.exec(modulesSource)
  while (match) {
    ids.add(match[1])
    match = pattern.exec(modulesSource)
  }
  return [...ids].sort()
}

export function splitModuleSource(source) {
  const start = source.indexOf('export const enabledModules')
  if (start < 0) return { staticIds: parseModuleIds(source), conditionalIds: [] }
  const end = source.indexOf('\n]', start)
  const staticSection = end > start ? source.slice(start, end) : source.slice(start)
  const staticIds = parseModuleIds(staticSection)
  const conditionalIds = end > start ? parseModuleIds(source.slice(end)).filter((id) => !staticIds.includes(id)) : []
  return { staticIds, conditionalIds }
}

export function readModuleList(repoRoot = REPO_ROOT) {
  const path = join(repoRoot, 'apps', 'mercato', 'src', 'modules.ts')
  if (!existsSync(path)) return { staticIds: [], conditionalIds: [] }
  return splitModuleSource(readFileSync(path, 'utf8'))
}

export function buildMigrationHead(rows) {
  const modules = {}
  for (const row of rows) modules[row.module] = row.name
  const canonical = Object.keys(modules).sort().map((key) => `${key}=${modules[key]}`).join('\n')
  const latest = Object.values(modules).filter(Boolean).sort().at(-1) ?? null
  return {
    hash: createHash('sha256').update(canonical).digest('hex').slice(0, 16),
    latest,
    count: rows.reduce((total, row) => total + Number(row.count ?? 0), 0),
    modules,
  }
}

export async function queryMigrationHead(sut, database) {
  const tables = await sut.psqlJson(
    "select table_name from information_schema.tables where table_schema = 'public' and table_name like 'mikro\\_orm\\_migrations%'",
    { database },
  )
  if (!tables.length) return buildMigrationHead([])
  const unions = tables
    .map((row) => row.table_name)
    .filter((name) => /^[a-z0-9_]+$/.test(name))
    .map((name) => `select '${name.replace(/^mikro_orm_migrations_?/, '') || 'core'}' as module, max(name) as name, count(*) as count from "${name}"`)
    .join(' union all ')
  const rows = await sut.psqlJson(unions, { database })
  return buildMigrationHead(rows)
}

export async function gitSha(sut) {
  const result = sut.remote
    ? await sut.shell('git rev-parse HEAD', { allowFail: true })
    : await runProcess('git', ['rev-parse', 'HEAD'], { allowFail: true })
  const dirty = sut.remote
    ? await sut.shell('git status --porcelain --untracked-files=no | head -1', { allowFail: true })
    : await runProcess('git', ['status', '--porcelain', '--untracked-files=no'], { allowFail: true })
  const sha = result.stdout.trim() || null
  return sha && dirty.stdout.trim() ? `${sha}-dirty` : sha
}

export async function imageDigest(sut, image) {
  const result = await sut.docker(['image', 'inspect', image, '--format', '{{.Id}}'], { allowFail: true })
  return result.code === 0 ? result.stdout.trim() : null
}

export async function hardwareFacts(sut) {
  const script = "printf 'nproc=%s\\n' \"$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null)\"; (free -b 2>/dev/null | awk '/^Mem:/ {print \"memBytes=\" $2}') || true; (lsblk -d -o NAME,ROTA,TYPE 2>/dev/null | awk '$3==\"disk\" {print \"disk_\" $1 \"=\" ($2==0?\"ssd\":\"hdd\")}') || true; uname -sr | sed 's/^/kernel=/'"
  const result = await sut.shell(script, { allowFail: true })
  const facts = {}
  for (const line of result.stdout.split('\n')) {
    const separator = line.indexOf('=')
    if (separator > 0) facts[line.slice(0, separator)] = line.slice(separator + 1)
  }
  const dockerInfo = await sut.docker(['info', '--format', '{{.NCPU}} {{.MemTotal}}'], { allowFail: true })
  const [dockerCpus, dockerMemory] = dockerInfo.stdout.trim().split(' ')
  if (dockerCpus) facts.dockerCpus = dockerCpus
  if (dockerMemory) facts.dockerMemBytes = dockerMemory
  return facts
}

export function datasetAgeDays(anchor, now = new Date()) {
  if (!anchor) return null
  const anchorTime = Date.parse(`${anchor}T00:00:00Z`)
  if (Number.isNaN(anchorTime)) return null
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  return Math.round((today - anchorTime) / 86400000)
}
