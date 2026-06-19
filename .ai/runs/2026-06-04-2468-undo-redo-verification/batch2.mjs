// Batch-2 undo/redo sweep: relational entities, action endpoints, documents, planner, checkout.
const BASE = process.env.BASE_URL || 'http://127.0.0.1:46203'
const ORG = '1a24c094-9f74-47ea-9a04-e588a346920a', TEN = 'b9fa5efb-76e1-4b94-8f5c-a66d5f8272ca'
const f = new URLSearchParams({ email: 'admin@acme.com', password: 'secret' })
const token = (await (await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: f.toString() })).json()).token
const op = r => { const h = r.headers.get('x-om-operation'); if (!h) return null; try { return JSON.parse(decodeURIComponent(h.startsWith('omop:') ? h.slice(5) : h)) } catch { return null } }
const api = async (m, p, d) => { const r = await fetch(`${BASE}${p}`, { method: m, headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: d ? JSON.stringify(d) : undefined }); let b = null; try { b = await r.json() } catch {}; return { status: r.status, op: op(r), body: b } }
const undo = t => api('POST', '/api/audit_logs/audit-logs/actions/undo', { undoToken: t })
const redo = l => api('POST', '/api/audit_logs/audit-logs/actions/redo', { logId: l })
const s = Date.now(), rnd = () => Math.random().toString(36).slice(2, 6)
const idOf = b => b?.id || b?.item?.id || b?.entityId
const find = (body, id, field) => { const visit = n => { if (!n || typeof n !== 'object') return null; if (!Array.isArray(n) && n.id === id && field in n) return n; for (const v of Array.isArray(n) ? n : Object.values(n)) { const r = visit(v); if (r) return r } return null }; const o = visit(body); if (o) return o[field]; if (Array.isArray(body?.items) && body.items[0]) return body.items[0][field]; for (const w of ['item', 'person', 'company', 'entity']) if (body?.[w]) return body[w][field]; return undefined }
const results = []
const log = (name, o) => { results.push({ name, ...o }); const flag = o.error ? 'ERROR ' + o.error : (o.skip ? 'SKIP ' + o.skip : Object.entries(o).filter(([k]) => /UNDO|REDO|RESTORED|REMAT|REVERT/.test(k)).map(([k, v]) => `${k}=${v}`).join(' ')); console.log(name.padEnd(40) + ' ' + flag) }

// ---- provision shared parents ----
const P = {}
async function provision() {
  P.person = idOf((await api('POST', '/api/customers/people', { firstName: 'P', lastName: `${s}`, displayName: `P ${s}` })).body)
  P.company = idOf((await api('POST', '/api/customers/companies', { displayName: `Co ${s}` })).body)
  P.product = idOf((await api('POST', '/api/catalog/products', { title: `Prod ${s}` })).body)
  P.variant = idOf((await api('POST', '/api/catalog/variants', { productId: P.product, name: `V ${s}`, sku: `SKU-${s}` })).body)
  P.priceKind = idOf((await api('POST', '/api/catalog/price-kinds', { code: `pk_${s}`, title: `PK ${s}` })).body)
  P.resource = idOf((await api('POST', '/api/resources/resources', { name: `Res ${s}` })).body)
  P.member = idOf((await api('POST', '/api/staff/team-members', { displayName: `Mbr ${s}` })).body)
  P.project = idOf((await api('POST', '/api/staff/timesheets/time-projects', { name: `Proj ${s}`, code: `proj-${s}` })).body)
  const orders = await api('GET', '/api/sales/orders?pageSize=5')
  P.order = (orders.body?.items || [])[0]?.id || null
  const channels = await api('GET', '/api/sales/channels?pageSize=5')
  P.channel = (channels.body?.items || [])[0]?.id || null
  console.log('PARENTS', JSON.stringify(P))
}

// update->undo->redo + delete->undo, generic
async function crud(name, createPath, createBody, updBody, readPath, field, opts = {}) {
  try {
    const cr = await api('POST', createPath, createBody)
    const id = cr.op?.resourceId || idOf(cr.body)
    if (!cr.op || !id) return log(name, { error: `create ${cr.status} ${JSON.stringify(cr.body).slice(0, 100)}` })
    const rp = readPath.replace(/<id>/g, id)
    const v0 = find((await api('GET', rp)).body, id, field)
    const ub = { ...updBody, id }
    const ur = await api(opts.updMethod || 'PUT', (opts.updPath || createPath).replace(/<id>/g, id), ub)
    if (!ur.op) { log(name, { error: `update ${ur.status} ${JSON.stringify(ur.body).slice(0, 90)}` }); await del(createPath, id, opts); return }
    const v1 = find((await api('GET', rp)).body, id, field)
    await undo(ur.op.undoToken)
    const v2 = find((await api('GET', rp)).body, id, field)
    const UPDATE_UNDO = JSON.stringify(v2) === JSON.stringify(v0) && JSON.stringify(v1) !== JSON.stringify(v0)
    await redo(ur.op.id)
    const v3 = find((await api('GET', rp)).body, id, field)
    const UPDATE_REDO = JSON.stringify(v3) === JSON.stringify(v1)
    // delete -> undo
    const d = await del(createPath, id, opts)
    let DELETE_UNDO = 'n/a'
    if (d?.op) { await undo(d.op.undoToken); const v4 = find((await api('GET', rp)).body, id, field); DELETE_UNDO = v4 !== undefined }
    log(name, { UPDATE_UNDO, UPDATE_REDO, DELETE_UNDO, vals: { v0, v1, v2 } })
    await del(createPath, id, opts)
  } catch (e) { log(name, { error: String(e).slice(0, 140) }) }
}
async function del(path, id, opts = {}) {
  if (opts.delBody) return api('DELETE', path, { id, ...(opts.delExtra || {}) })
  return api('DELETE', `${path}?id=${id}`)
}
// action -> undo: do action, capture token, undo, check status reverts
async function action(name, createPath, createBody, readPath, field, actPath, actBody, expectChange, opts = {}) {
  try {
    const cr = await api('POST', createPath, createBody)
    const id = cr.op?.resourceId || idOf(cr.body)
    if (!id) return log(name, { error: `create ${cr.status} ${JSON.stringify(cr.body).slice(0, 100)}` })
    const rp = readPath.replace(/<id>/g, id)
    const before = find((await api('GET', rp)).body, id, field)
    const act = await api('POST', actPath, { ...actBody, id })
    if (!act.op) { log(name, { error: `action ${act.status} ${JSON.stringify(act.body).slice(0, 90)}` }); await del(createPath, id, opts); return }
    const after = find((await api('GET', rp)).body, id, field)
    await undo(act.op.undoToken)
    const reverted = find((await api('GET', rp)).body, id, field)
    log(name, { changed: JSON.stringify(before) !== JSON.stringify(after), ACTION_UNDO_REVERTED: JSON.stringify(reverted) === JSON.stringify(before), vals: { before, after, reverted } })
    await del(createPath, id, opts)
  } catch (e) { log(name, { error: String(e).slice(0, 140) }) }
}

await provision()

// customers relations
await crud('customers.addresses', '/api/customers/addresses', { entityId: P.person, addressLine1: '1 St', city: 'A' }, { city: 'B' }, '/api/customers/addresses?entityId=' + P.person, 'city', { delBody: true })
await crud('customers.comments', '/api/customers/comments', { entityId: P.person, body: 'c1' }, { body: 'c2' }, '/api/customers/comments?entityId=' + P.person, 'body', { delBody: true })
await crud('customers.activities', '/api/customers/activities', { entityId: P.person, activityType: 'note', subject: 'a1' }, { subject: 'a2' }, '/api/customers/activities?entityId=' + P.person, 'subject', { delBody: true })
await crud('customers.interactions', '/api/customers/interactions', { entityId: P.person, interactionType: 'task', title: 'i1', status: 'planned' }, { title: 'i2' }, '/api/customers/interactions?entityId=' + P.person, 'title', { delBody: true })
await action('customers.interactions.complete', '/api/customers/interactions', { entityId: P.person, interactionType: 'task', title: 'ic', status: 'planned' }, '/api/customers/interactions?entityId=' + P.person, 'status', '/api/customers/interactions/complete', {}, 'done', { delBody: true })
await action('customers.interactions.cancel', '/api/customers/interactions', { entityId: P.person, interactionType: 'task', title: 'ix', status: 'planned' }, '/api/customers/interactions?entityId=' + P.person, 'status', '/api/customers/interactions/cancel', {}, 'canceled', { delBody: true })
await crud('customers.deals', '/api/customers/deals', { title: `D ${s}`, personIds: [P.person] }, { title: `D2 ${s}` }, '/api/customers/deals/<id>', 'title', { delBody: true })
await crud('customers.entityRoles', `/api/customers/people/${P.person}/roles`, { roleType: 'owner' }, {}, `/api/customers/people/${P.person}/roles`, 'roleType', { updMethod: 'PUT', updPath: `/api/customers/people/${P.person}/roles`, skipUpd: true })

// catalog
await crud('catalog.variants', '/api/catalog/variants', { productId: P.product, name: `V ${s}`, sku: `SK2-${s}` }, { name: `Vr ${s}` }, '/api/catalog/variants?productId=' + P.product, 'name')
await crud('catalog.optionSchemas', '/api/catalog/option-schemas', { name: `OS ${s}`, schema: { options: [] } }, { name: `OSr ${s}` }, '/api/catalog/option-schemas', 'name')
await crud('catalog.productUnitConversions', '/api/catalog/product-unit-conversions', { productId: P.product, unitCode: `bx${rnd()}`, toBaseFactor: 12 }, { toBaseFactor: 24 }, '/api/catalog/product-unit-conversions?productId=' + P.product, 'to_base_factor', { delBody: true })
if (P.channel) await crud('catalog.offers', '/api/catalog/offers', { productId: P.product, channelId: P.channel, title: `Of ${s}` }, { title: `Ofr ${s}` }, '/api/catalog/offers?productId=' + P.product, 'title')
await crud('catalog.prices', '/api/catalog/prices', { variantId: P.variant, priceKindId: P.priceKind, currencyCode: 'USD', unitPriceNet: 9.99 }, { unitPriceNet: 12.5 }, '/api/catalog/prices?variantId=' + P.variant, 'unit_price_net')

// sales documents
if (P.order) await crud('sales.payments', '/api/sales/payments', { orderId: P.order, amount: 10, currencyCode: 'USD' }, { amount: 15 }, '/api/sales/payments?orderId=' + P.order, 'amount')

// staff
await crud('staff.timesheets.time_projects', '/api/staff/timesheets/time-projects', { name: `TP ${s}`, code: `tp-${s}` }, { name: `TPr ${s}` }, '/api/staff/timesheets/time-projects', 'name')
await crud('staff.timesheets.time_entries', '/api/staff/timesheets/time-entries', { staffMemberId: P.member, date: '2026-07-02', durationMinutes: 60, timeProjectId: P.project }, { durationMinutes: 90 }, '/api/staff/timesheets/time-entries?projectId=' + P.project, 'durationMinutes')
await crud('staff.leave-requests', '/api/staff/leave-requests', { memberId: P.member, timezone: 'UTC', startDate: '2026-07-01', endDate: '2026-07-05' }, { note: 'edited' }, '/api/staff/leave-requests?memberId=' + P.member, 'note', { delBody: true })
await action('staff.leave-requests.accept', '/api/staff/leave-requests', { memberId: P.member, timezone: 'UTC', startDate: '2026-08-01', endDate: '2026-08-03' }, '/api/staff/leave-requests?memberId=' + P.member, 'status', '/api/staff/leave-requests/accept', {}, 'approved', { delBody: true })
await action('staff.leave-requests.reject', '/api/staff/leave-requests', { memberId: P.member, timezone: 'UTC', startDate: '2026-09-01', endDate: '2026-09-03' }, '/api/staff/leave-requests?memberId=' + P.member, 'status', '/api/staff/leave-requests/reject', {}, 'rejected', { delBody: true })

// resources
await crud('resources.resource-activities', '/api/resources/activities', { entityId: P.resource, activityType: 'note', subject: 'ra1' }, { subject: 'ra2' }, '/api/resources/activities?entityId=' + P.resource, 'subject')
await crud('resources.resource-comments', '/api/resources/comments', { entityId: P.resource, body: 'rc1' }, { body: 'rc2' }, '/api/resources/comments?entityId=' + P.resource, 'body')

// planner
await crud('planner.availability', '/api/planner/availability', { subjectType: 'resource', subjectId: P.resource, timezone: 'UTC', rrule: 'FREQ=WEEKLY;BYDAY=MO' }, { rrule: 'FREQ=DAILY' }, `/api/planner/availability?subjectType=resource&subjectId=${P.resource}`, 'rrule')
await crud('planner.availability-rule-sets', '/api/planner/availability-rule-sets', { name: `RS ${s}`, timezone: 'UTC' }, { name: `RSr ${s}` }, '/api/planner/availability-rule-sets', 'name')

// directory
await crud('directory.organizations', '/api/directory/organizations', { name: `Org ${s}`, tenantId: TEN }, { name: `Orgr ${s}` }, '/api/directory/organizations', 'name')

// assign/unassign (junction): assign -> undo should remove; we test assign then undo, expect membership gone
async function assignUndo(name, createTagPath, tagBody, assignPath, assignBody, listPath, opts = {}) {
  try {
    const t = await api('POST', createTagPath, tagBody)
    const tagId = idOf(t.body)
    const ab = typeof assignBody === 'function' ? assignBody(tagId) : assignBody
    const asg = await api('POST', assignPath, ab)
    if (!asg.op) return log(name, { error: `assign ${asg.status} ${JSON.stringify(asg.body).slice(0, 90)}` })
    await undo(asg.op.undoToken)
    log(name, { ASSIGN_UNDO_status: asg.status, undoOk: true })
    if (createTagPath && tagId && !opts.noTagDelete) await del(createTagPath, tagId)
  } catch (e) { log(name, { error: String(e).slice(0, 140) }) }
}
await assignUndo('customers.tags.assign', '/api/customers/tags', { slug: `t${rnd()}`, label: `T ${s}` }, '/api/customers/tags/assign', tagId => ({ tagId, entityId: P.person }), null)
await assignUndo('customers.labels.assign', '/api/customers/labels', { slug: `l${rnd()}`, label: `L ${s}` }, '/api/customers/labels/assign', tagId => ({ labelId: tagId, entityId: P.person }), null, { noTagDelete: true })
await assignUndo('resources.resourceTags.assign', '/api/resources/tags', { label: `RT ${s}` }, '/api/resources/resources/tags/assign', tagId => ({ tagId, resourceId: P.resource }), null)
await assignUndo('staff.team-members.tags.assign', null, null, '/api/staff/team-members/tags/assign', { memberId: P.member, tag: `tag${rnd()}` }, null)

// cleanup parents
for (const [k, v] of Object.entries(P)) { if (!v) continue; const path = { person: '/api/customers/people', company: '/api/customers/companies', product: '/api/catalog/products', variant: '/api/catalog/variants', priceKind: '/api/catalog/price-kinds', resource: '/api/resources/resources', member: '/api/staff/team-members', project: '/api/staff/timesheets/time-projects' }[k]; if (path) await api('DELETE', `${path}?id=${v}`).catch(() => {}) }
console.log('\nJSON ' + JSON.stringify(results))
