// Uniform undo/redo sweep across live-validated entity contracts.
// create→update→undo(update)→redo→delete→undo(delete), asserting field restore each step.
const BASE = process.env.BASE_URL || 'http://127.0.0.1:46203'
const f = new URLSearchParams({ email: 'admin@acme.com', password: 'secret' })
const token = (await (await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: f.toString() })).json()).token
const ORG = '1a24c094-9f74-47ea-9a04-e588a346920a'
const TEN = 'b9fa5efb-76e1-4b94-8f5c-a66d5f8272ca'
const op = r => { const h = r.headers.get('x-om-operation'); if (!h) return null; try { return JSON.parse(decodeURIComponent(h.startsWith('omop:') ? h.slice(5) : h)) } catch { return null } }
const api = async (m, p, d) => { const r = await fetch(`${BASE}${p}`, { method: m, headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: d ? JSON.stringify(d) : undefined }); let b = null; try { b = await r.json() } catch {}; return { status: r.status, op: op(r), body: b } }
const undo = t => api('POST', '/api/audit_logs/audit-logs/actions/undo', { undoToken: t })
const redo = l => api('POST', '/api/audit_logs/audit-logs/actions/redo', { logId: l })

// find the entity object (by id) within a read response and return scalar field
function readField(body, id, field) {
  if (!body || typeof body !== 'object') return undefined
  const visit = (node) => {
    if (!node || typeof node !== 'object') return null
    if (!Array.isArray(node) && (node.id === id) && (field in node)) return node
    for (const v of Array.isArray(node) ? node : Object.values(node)) { const r = visit(v); if (r) return r }
    return null
  }
  const obj = visit(body)
  if (obj) return obj[field]
  // fallback: items[0] or known wrappers
  if (Array.isArray(body.items) && body.items[0]) return body.items[0][field]
  for (const w of ['item', 'person', 'company', 'channel', 'entity']) if (body[w]) return body[w][field]
  return undefined
}

const s = Date.now()
const rnd = () => Math.random().toString(36).slice(2, 5)
function uniq(entity, payload) {
  const p = JSON.parse(JSON.stringify(payload))
  if (entity === 'currencies.currencies') p.code = (rnd() + rnd()).slice(0, 3).toUpperCase()
  if ('code' in p && entity !== 'currencies.currencies') p.code = `${p.code}_${s}_${rnd()}`
  if ('identifier' in p) p.identifier = `${p.identifier}_${s}`
  if ('email' in p) p.email = `undo-${s}-${rnd()}@example.com`
  if ('name' in p) p.name = `${p.name} ${s}`
  if ('title' in p) p.title = `${p.title} ${s}`
  return p
}

const contracts = JSON.parse(await (await import('node:fs/promises')).readFile(new URL('./contracts.json', import.meta.url), 'utf8'))
const results = []
for (const c of contracts) {
  if (c.blocked) { results.push({ entity: c.entity, blocked: c.blocked }); continue }
  const r = { entity: c.entity }
  let id = null
  try {
    let cp = uniq(c.entity, c.createPayload)
    if (/currencies|auth\.users/.test(c.entity)) { cp.organizationId = cp.organizationId || ORG; cp.tenantId = cp.tenantId || TEN }
    const cr = await api(c.createMethod, c.createPath, cp)
    id = cr.op?.resourceId || cr.body?.id || cr.body?.item?.id
    r.create = cr.status; r.resourceId = id
    if (!cr.op || !id) { r.error = `no op/id (create ${cr.status})`; results.push(r); continue }
    const rp = (sub) => c.readPath.replace(/<resourceId>/g, sub)
    const afterCreate = readField((await api('GET', rp(id))).body, id, c.scalarField)

    // UPDATE
    const up = JSON.parse(JSON.stringify(c.updatePayload)); up.id = id
    for (const k of Object.keys(up)) if (typeof up[k] === 'string') up[k] = up[k].replace(/<resourceId>/g, id)
    if (/currencies|auth\.users/.test(c.entity)) { up.organizationId = up.organizationId || ORG; up.tenantId = up.tenantId || TEN }
    const ur = await api(c.updateMethod, c.updatePath || c.createPath, up)
    r.update = ur.status
    if (!ur.op) { r.error = `update no token (${ur.status}) ${JSON.stringify(ur.body).slice(0,120)}`; results.push(r); await cleanup(c, id); continue }
    const afterUpdate = readField((await api('GET', rp(id))).body, id, c.scalarField)
    r.changed = JSON.stringify(afterCreate) !== JSON.stringify(afterUpdate)

    // UNDO update
    const un = await undo(ur.op.undoToken); r.undo = un.status
    const afterUndo = readField((await api('GET', rp(id))).body, id, c.scalarField)
    r.UPDATE_UNDO_RESTORED = JSON.stringify(afterUndo) === JSON.stringify(afterCreate)
    r.vals = { create: afterCreate, update: afterUpdate, undo: afterUndo }

    // REDO update
    const re = await redo(ur.op.id); r.redo = re.status
    const afterRedo = readField((await api('GET', rp(id))).body, id, c.scalarField)
    r.UPDATE_REDO_REAPPLIED = JSON.stringify(afterRedo) === JSON.stringify(afterUpdate)

    // DELETE → UNDO
    const del = await api('DELETE', `${c.createPath}?id=${id}`, undefined)
    r.delete = del.status
    if (del.op) {
      const goneStatus = (await api('GET', rp(id))).status
      const un2 = await undo(del.op.undoToken); r.deleteUndo = un2.status
      const reread = await api('GET', rp(id))
      const afterDelUndo = readField(reread.body, id, c.scalarField)
      r.DELETE_UNDO_REMATERIALIZED = afterDelUndo !== undefined && JSON.stringify(afterDelUndo) === JSON.stringify(afterUpdate)
    } else { r.deleteNote = `delete no token (${del.status})` }
  } catch (e) { r.error = String(e).slice(0, 160) }
  await cleanup(c, id)
  results.push(r)
}
async function cleanup(c, id) { if (id) await api('DELETE', `${c.createPath}?id=${id}`).catch(() => {}) }

for (const r of results) {
  const flag = r.blocked ? 'BLOCKED' : (r.error ? 'ERROR' : `uUndo=${r.UPDATE_UNDO_RESTORED} uRedo=${r.UPDATE_REDO_REAPPLIED} delUndo=${r.DELETE_UNDO_REMATERIALIZED}`)
  console.log(`${r.entity.padEnd(28)} ${flag}${r.error ? ' :: ' + r.error : ''}${r.blocked ? ' :: ' + String(r.blocked).slice(0,60) : ''}`)
}
console.log('\nJSON', JSON.stringify(results))
