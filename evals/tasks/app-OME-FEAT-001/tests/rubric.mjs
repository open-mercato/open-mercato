// Convention rubric for app-OME-FEAT-001. Programmatic AST/fs checks are
// authoritative; C-SCOPE-1 may consult the optional LLM judge. Each criterion
// returns { id, weight, title, file, score: 0|1, rationale } where `rationale`
// names, in plain English, exactly which expectation failed (or 'all checks
// passed'), so a failing run can be diagnosed from the report alone.
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const read = (p) => { try { return readFileSync(p, 'utf8') } catch { return '' } }
const exists = (p) => existsSync(p)
const lsdir = (p) => { try { return readdirSync(p) } catch { return [] } }

// Strip line/block comments so heuristics don't match commented-out code.
const decomment = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

// checks: [{ ok: boolean, why: 'expectation, phrased for a human' }]
function criterion(id, weight, title, file, checks) {
  const failed = checks.filter((c) => !c.ok)
  return {
    id,
    weight,
    title,
    file,
    score: failed.length === 0 ? 1 : 0,
    rationale: failed.length === 0 ? 'all checks passed' : failed.map((c) => c.why).join(' | '),
  }
}

export function runProgrammaticRubric(appDir) {
  const mod = join(appDir, 'src', 'modules', 'bookmarks')
  const entitiesPath = firstExisting([join(mod, 'data', 'entities.ts'), join(mod, 'data', 'entities.tsx')])
  const validatorsPath = join(mod, 'data', 'validators.ts')
  const routePath = firstExisting([join(mod, 'api', 'route.ts'), join(mod, 'api', 'route.tsx')])
  const aclPath = join(mod, 'acl.ts')
  const modulesTsPath = join(appDir, 'src', 'modules.ts')
  const migrationsDir = join(mod, 'migrations')

  const entities = decomment(read(entitiesPath))
  const validators = decomment(read(validatorsPath))
  const route = decomment(read(routePath))
  const acl = decomment(read(aclPath))
  const modulesTs = decomment(read(modulesTsPath))

  const out = []

  // C-REUSE-2 — CRUD via the platform's route factory; no raw SQL / bespoke handlers.
  out.push(criterion('C-REUSE-2', 3, 'CRUD built on the platform route factory', 'src/modules/bookmarks/api/route.ts', [
    {
      ok: /makeCrudRoute/.test(route) && /from\s+['"]@open-mercato\/shared\/lib\/crud\/factory['"]/.test(route),
      why: "route does not import makeCrudRoute from '@open-mercato/shared/lib/crud/factory'",
    },
    {
      ok: !/getConnection\s*\(|execute\s*\(\s*['"`]\s*(select|insert|update|delete)/i.test(route),
      why: 'route contains raw SQL (getConnection/execute with SQL) instead of going through the factory',
    },
    {
      ok: !/export\s+(async\s+)?function\s+(GET|POST|PUT|DELETE)\b/.test(route),
      why: 'route hand-writes exported GET/POST/PUT/DELETE handlers instead of re-exporting the factory result',
    },
  ]))

  // C-PLACE-1 — standard module layout + registered in src/modules.ts.
  out.push(criterion('C-PLACE-1', 2, 'Standard module layout, registered in src/modules.ts', 'src/modules/bookmarks/', [
    { ok: exists(join(mod, 'data')), why: 'missing src/modules/bookmarks/data/ directory' },
    { ok: exists(join(mod, 'api')), why: 'missing src/modules/bookmarks/api/ directory' },
    { ok: exists(aclPath), why: 'missing src/modules/bookmarks/acl.ts' },
    { ok: exists(join(mod, 'index.ts')), why: 'missing src/modules/bookmarks/index.ts' },
    { ok: exists(migrationsDir), why: 'missing src/modules/bookmarks/migrations/ directory' },
    {
      ok: /id:\s*['"]bookmarks['"]/.test(modulesTs) && /from:\s*['"]@app['"]/.test(modulesTs),
      why: "module not registered in src/modules.ts as { id: 'bookmarks', from: '@app' }",
    },
  ]))

  // C-NAME-1 — plural snake_case table; features named module.action.
  out.push(criterion('C-NAME-1', 2, 'Naming conventions (table + ACL feature ids)', 'src/modules/bookmarks/{data/entities.ts,acl.ts}', [
    { ok: /tableName:\s*['"]bookmarks['"]/.test(entities), why: "entity is not mapped to tableName: 'bookmarks' (plural snake_case)" },
    { ok: /['"]bookmarks\.view['"]/.test(acl), why: "acl.ts does not declare a 'bookmarks.view' feature" },
    { ok: /['"]bookmarks\.manage['"]/.test(acl), why: "acl.ts does not declare a 'bookmarks.manage' feature" },
  ]))

  // C-ENTITY-1 — UUID PK, org+tenant scoping, indexed, soft delete, timestamps, note nullable.
  out.push(criterion('C-ENTITY-1', 2, 'Entity conventions (multi-tenant, soft delete, nullable note)', 'src/modules/bookmarks/data/entities.ts', [
    { ok: /@PrimaryKey\([^)]*type:\s*['"]uuid['"]/.test(entities), why: 'primary key is not a uuid (@PrimaryKey({ type: \'uuid\' }))' },
    { ok: /name:\s*['"]organization_id['"]/.test(entities) || /\borganizationId\s*[!?]?\s*:/.test(entities), why: 'no organization_id / organizationId column (tenant scoping)' },
    { ok: /name:\s*['"]tenant_id['"]/.test(entities) || /\btenantId\s*[!?]?\s*:/.test(entities), why: 'no tenant_id / tenantId column (tenant scoping)' },
    { ok: /@Index\(/.test(entities) && /organizationId/.test(entities) && /tenantId/.test(entities), why: 'no @Index covering organizationId + tenantId' },
    { ok: /name:\s*['"]deleted_at['"]/.test(entities) || /\bdeletedAt\s*[!?]?\s*:/.test(entities), why: 'no deleted_at / deletedAt column (soft delete)' },
    { ok: (/name:\s*['"]created_at['"]/.test(entities) || /\bcreatedAt\s*[!?:]/.test(entities)) && (/name:\s*['"]updated_at['"]/.test(entities) || /\bupdatedAt\s*[!?:]/.test(entities)), why: 'missing created_at / updated_at timestamp columns' },
    {
      // Accept both orders — `name: 'note', …, nullable: true` and the
      // decorator-above-property form `@Property({ …, nullable: true })\n note?: …`.
      ok: /note[\s\S]{0,120}?nullable:\s*true/.test(entities) || /nullable:\s*true[\s\S]{0,80}?\bnote\s*[?!]?\s*:/.test(entities),
      why: 'the note property is not declared nullable (nullable: true) — note must be optional at the DB level',
    },
  ]))

  // C-VALID-1 — zod; url validated; note optional; z.infer types; no new `any`.
  out.push(criterion('C-VALID-1', 2, 'Input validation with zod', 'src/modules/bookmarks/data/validators.ts', [
    { ok: /from\s+['"]zod['"]/.test(validators), why: 'validators.ts does not import zod' },
    {
      // Accept any zod chain containing .url(…) on the url field — with or
      // without a custom error message (e.g. z.string().trim().url('Must be a
      // valid URL').max(…)) — and zod v4's top-level z.url(…).
      ok: /url\s*:[\s\S]{0,120}?\.url\(/.test(validators) || /url\s*:\s*z\.url\(/.test(validators),
      why: 'the url field is not validated as a URL (no .url(…) / z.url(…) in its zod chain)',
    },
    { ok: /note[\s\S]{0,80}?\.optional\(/.test(validators), why: 'the note field is not .optional() in the create schema' },
    { ok: /z\.infer<\s*typeof/.test(validators), why: 'TypeScript types are not derived with z.infer<typeof …>' },
    { ok: !/:\s*any\b/.test(validators) && !/<any>/.test(validators), why: 'validators.ts introduces `any` types' },
  ]))

  // C-MIG-1 — real CLI migration whose up() creates bookmarks. down() is deliberately
  // NOT required: MikroORM's initial-module migration (the canonical `yarn db:generate`
  // output for a brand-new module) emits only up().
  {
    const files = lsdir(migrationsDir).filter((f) => /^Migration\d{14}.*\.ts$/.test(f))
    let upOk = false
    for (const f of files) {
      const src = decomment(read(join(migrationsDir, f)))
      if (/\b(async\s+)?up\s*\(/.test(src) && /bookmarks/.test(src)) { upOk = true; break }
    }
    out.push(criterion('C-MIG-1', 2, 'Real CLI-generated database migration', 'src/modules/bookmarks/migrations/', [
      { ok: files.length > 0, why: 'no Migration<14-digit-timestamp>*.ts file — run `yarn db:generate` to create a real migration' },
      { ok: files.length === 0 || upOk, why: 'no migration has an up() that creates the bookmarks table' },
    ]))
  }

  // C-AUTH-1 — per-method requireAuth + requireFeatures; no top-level requireAuth export.
  {
    const methods = ['GET', 'POST', 'PUT', 'DELETE']
    const missing = methods.filter((m) => !new RegExp(m + "\\s*:\\s*\\{[^}]*requireAuth[^}]*requireFeatures", 's').test(route))
    out.push(criterion('C-AUTH-1', 2, 'Per-method auth + feature gating in route metadata', 'src/modules/bookmarks/api/route.ts', [
      {
        ok: missing.length === 0,
        why: `route metadata lacks requireAuth + requireFeatures for: ${missing.join(', ') || '-'}`,
      },
      {
        ok: !/export\s+const\s+requireAuth\b/.test(route),
        why: 'route exports a top-level `requireAuth` const instead of per-method metadata',
      },
    ]))
  }

  return out
}

// C-SCOPE-1 — minimal & idiomatic. Programmatic pre-check detects spurious surfaces;
// when present, the judge (if available) resolves, else we flag conservatively.
export function detectScopeArtifacts(appDir) {
  const mod = join(appDir, 'src', 'modules', 'bookmarks')
  const spurious = []
  if (exists(join(mod, 'events.ts'))) spurious.push('events.ts')
  if (exists(join(mod, 'subscribers')) && lsdir(join(mod, 'subscribers')).length) spurious.push('subscribers/')
  if (exists(join(mod, 'widgets')) && lsdir(join(mod, 'widgets')).length) spurious.push('widgets/')
  return spurious
}

const SCOPE_TITLE = 'Minimal scope (no invented events/subscribers/widgets)'
const SCOPE_FILE = 'src/modules/bookmarks/'

export async function judgeScopeCriterion(appDir, { apiKey, model }) {
  const spurious = detectScopeArtifacts(appDir)
  if (spurious.length === 0) {
    return scopeResult(1, 'all checks passed')
  }
  if (!apiKey) {
    return scopeResult(0, `module ships surfaces a plain CRUD module does not need: ${spurious.join(', ')} (no judge key available to assess justification)`)
  }
  const prompt = `A coding agent built a plain CRUD module "bookmarks" in Open Mercato. ` +
    `Rule C-SCOPE-1: the module should be minimal and idiomatic — NO invented events/subscribers/widgets for a plain CRUD module unless they have a real consumer. ` +
    `The module contains these extra surfaces: ${spurious.join(', ')}. ` +
    `Decide: are these justified (score 1) or spurious/unnecessary (score 0)? ` +
    `Reply with ONLY compact JSON: {"score":0|1,"rationale":"..."}.`
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: model || 'claude-opus-4-8', max_tokens: 300, messages: [{ role: 'user', content: prompt }] }),
    })
    const data = await res.json()
    const text = (data?.content?.[0]?.text || '').trim()
    const parsed = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1))
    return scopeResult(parsed.score === 1 ? 1 : 0, `judge: ${parsed.rationale}`)
  } catch (e) {
    return scopeResult(0, `module ships extra surfaces (${spurious.join(', ')}) and the judge call failed: ${String(e).slice(0, 120)}`)
  }
}

function scopeResult(score, rationale) {
  return { id: 'C-SCOPE-1', weight: 1, title: SCOPE_TITLE, file: SCOPE_FILE, score, rationale }
}

function firstExisting(paths) {
  for (const p of paths) if (existsSync(p)) return p
  return paths[0]
}
