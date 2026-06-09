// Convention rubric for app-OME-FEAT-001. Programmatic AST/fs checks are
// authoritative; C-SCOPE-1 may consult the optional LLM judge. Each check returns
// { id, weight, score: 0|1, rationale }. Pure file inspection — no app runtime.
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const read = (p) => { try { return readFileSync(p, 'utf8') } catch { return '' } }
const exists = (p) => existsSync(p)
const lsdir = (p) => { try { return readdirSync(p) } catch { return [] } }

// Strip line/block comments so heuristics don't match commented-out code.
const decomment = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

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

  // C-REUSE-2 — CRUD via makeCrudRoute from the canonical factory; no raw SQL / bespoke handlers.
  {
    const importsFactory = /makeCrudRoute/.test(route) &&
      /from\s+['"]@open-mercato\/shared\/lib\/crud\/factory['"]/.test(route)
    const rawSql = /getConnection\s*\(|execute\s*\(\s*['"`]\s*(select|insert|update|delete)/i.test(route)
    const bespoke = /export\s+(async\s+)?function\s+(GET|POST|PUT|DELETE)\b/.test(route)
    out.push(crit('C-REUSE-2', 3, importsFactory && !rawSql && !bespoke,
      importsFactory ? (rawSql ? 'raw SQL in route' : bespoke ? 'bespoke handler exports' : 'makeCrudRoute from canonical factory')
                     : 'makeCrudRoute not imported from @open-mercato/shared/lib/crud/factory'))
  }

  // C-PLACE-1 — standard module layout + registered in src/modules.ts.
  {
    const layout = exists(join(mod, 'data')) && exists(join(mod, 'api')) && exists(aclPath) &&
      exists(join(mod, 'index.ts')) && exists(migrationsDir)
    const registered = /id:\s*['"]bookmarks['"]/.test(modulesTs) && /from:\s*['"]@app['"]/.test(modulesTs)
    out.push(crit('C-PLACE-1', 2, layout && registered,
      !layout ? 'missing standard module subdirs/files' : !registered ? "not registered in src/modules.ts as { id:'bookmarks', from:'@app' }" : 'standard layout + registered'))
  }

  // C-NAME-1 — plural snake_case module/table; features module.action.
  {
    const table = /tableName:\s*['"]bookmarks['"]/.test(entities)
    const featView = /['"]bookmarks\.view['"]/.test(acl)
    const featManage = /['"]bookmarks\.manage['"]/.test(acl)
    out.push(crit('C-NAME-1', 2, table && featView && featManage,
      `table 'bookmarks':${table}, bookmarks.view:${featView}, bookmarks.manage:${featManage}`))
  }

  // C-ENTITY-1 — UUID PK, snake_case cols, org+tenant indexed, soft delete, note nullable.
  {
    const uuidPk = /@PrimaryKey\([^)]*type:\s*['"]uuid['"]/.test(entities)
    const org = /name:\s*['"]organization_id['"]/.test(entities)
    const tenant = /name:\s*['"]tenant_id['"]/.test(entities)
    const indexed = /@Index\(/.test(entities) && /organizationId/.test(entities) && /tenantId/.test(entities)
    const softDelete = /name:\s*['"]deleted_at['"]/.test(entities)
    const createdUpdated = /name:\s*['"]created_at['"]/.test(entities) && /name:\s*['"]updated_at['"]/.test(entities)
    // note nullable: the `note` property must declare nullable: true
    const noteNullable = /note[\s\S]{0,120}?nullable:\s*true/.test(entities) || /name:\s*['"]note['"][\s\S]{0,80}?nullable:\s*true/.test(entities)
    const ok = uuidPk && org && tenant && indexed && softDelete && createdUpdated && noteNullable
    out.push(crit('C-ENTITY-1', 2, ok,
      `uuidPk:${uuidPk} org:${org} tenant:${tenant} indexed:${indexed} softDelete:${softDelete} ts:${createdUpdated} noteNullable:${noteNullable}`))
  }

  // C-VALID-1 — zod; url validated; note optional; z.infer types; no new `any`.
  {
    const hasZod = /from\s+['"]zod['"]/.test(validators)
    const urlValidated = /url[\s\S]{0,60}?z\.string\(\)\.url\(\)/.test(validators) || /z\.string\(\)\.url\(\)/.test(validators)
    const noteOptional = /note[\s\S]{0,80}?\.optional\(\)/.test(validators)
    const zInfer = /z\.infer<\s*typeof/.test(validators)
    const noAny = !/:\s*any\b/.test(validators) && !/<any>/.test(validators)
    const ok = hasZod && urlValidated && noteOptional && zInfer && noAny
    out.push(crit('C-VALID-1', 2, ok,
      `zod:${hasZod} urlValidated:${urlValidated} noteOptional:${noteOptional} zInfer:${zInfer} noAny:${noAny}`))
  }

  // C-MIG-1 — real CLI migration Migration<14-digit>*.ts with up()+down().
  {
    const files = lsdir(migrationsDir).filter((f) => /^Migration\d{14}.*\.ts$/.test(f))
    let upDown = false
    for (const f of files) {
      const src = decomment(read(join(migrationsDir, f)))
      if (/\b(async\s+)?up\s*\(/.test(src) && /\b(async\s+)?down\s*\(/.test(src) && /bookmarks/.test(src)) { upDown = true; break }
    }
    out.push(crit('C-MIG-1', 2, files.length > 0 && upDown,
      files.length === 0 ? 'no Migration<14-digit-ts>*.ts present' : upDown ? 'CLI migration with up()+down()' : 'migration missing up()/down() or unrelated'))
  }

  // C-AUTH-1 — per-method requireAuth + requireFeatures; no top-level requireAuth export.
  {
    const topLevel = /export\s+const\s+requireAuth\b/.test(route)
    const methods = ['GET', 'POST', 'PUT', 'DELETE']
    const perMethod = methods.every((m) => {
      const re = new RegExp(m + "\\s*:\\s*\\{[^}]*requireAuth[^}]*requireFeatures", 's')
      return re.test(route)
    })
    out.push(crit('C-AUTH-1', 2, perMethod && !topLevel,
      topLevel ? 'top-level export const requireAuth present' : perMethod ? 'per-method requireAuth + requireFeatures' : 'per-method auth metadata incomplete'))
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

export async function judgeScopeCriterion(appDir, { apiKey, model }) {
  const spurious = detectScopeArtifacts(appDir)
  if (spurious.length === 0) {
    return crit('C-SCOPE-1', 1, true, 'no events/subscribers/widgets for a plain CRUD module')
  }
  if (!apiKey) {
    return crit('C-SCOPE-1', 1, false, `spurious surfaces without a consumer: ${spurious.join(', ')} (no judge key; flagged)`)
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
    return crit('C-SCOPE-1', 1, parsed.score === 1, `judge: ${parsed.rationale}`)
  } catch (e) {
    return crit('C-SCOPE-1', 1, false, `spurious surfaces: ${spurious.join(', ')}; judge error: ${String(e).slice(0, 120)}`)
  }
}

function crit(id, weight, pass, rationale) {
  return { id, weight, score: pass ? 1 : 0, rationale }
}
function firstExisting(paths) {
  for (const p of paths) if (existsSync(p)) return p
  return paths[0]
}
