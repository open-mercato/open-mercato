import fs from 'node:fs/promises'
import constants from 'node:constants'
import path from 'node:path'
import { cleanText, errorExperiment, isRecord, MAX_JSON_BYTES, MAX_TEXT_BYTES, normalizeExperiment, OUTCOME_STATUSES } from './model.mjs'

const SENSITIVE = /^(?:\.env(?:\..*)?|\.git|\.ssh|\.aws|node_modules|auth\.json|\.?credentials\.json|mcp-auth\.json|\.npmrc|\.netrc|secrets?(?:\.json)?|.*\.(?:pem|key|p12|pfx))$/i
const ARTIFACT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/
const MAX_DIRECTORY_FILES = 2000

async function readJson(root, relative, maxBytes = MAX_JSON_BYTES) {
  const parts = relative.split('/')
  if (path.isAbsolute(relative) || relative.includes('\\') || parts.some(part => !part || part === '.' || part === '..' || SENSITIVE.test(part))) throw new Error('Unsafe artifact path')
  let resolved = root
  for (const part of parts) {
    resolved = path.join(resolved, part)
    const stat = await fs.lstat(resolved)
    if (part === parts.at(-1) && (!stat.isFile() || stat.size > maxBytes || stat.nlink > 1)) throw new Error('Experiment file must be bounded regular data')
    if (stat.isSymbolicLink()) throw new Error('Symlinked experiment files are not readable')
  }
  const file = await fs.open(resolved, constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0))
  try {
    const info = await file.stat()
    if (!info.isFile() || info.size > maxBytes) throw new Error('Experiment file exceeds the regular-file size limit')
    const real = await fs.realpath(resolved)
    if (real !== resolved || !real.startsWith(root + path.sep)) throw new Error('Experiment file escapes registered root')
    const lexicalInfo = await fs.stat(resolved)
    if (lexicalInfo.dev !== info.dev || lexicalInfo.ino !== info.ino || info.nlink > 1) throw new Error('Experiment file changed during read')
    const body = await file.readFile('utf8')
    if (Buffer.byteLength(body) > maxBytes) throw new Error('Experiment file exceeds the size limit')
    return { data: JSON.parse(body), mtime: info.mtime.toISOString() }
  } finally { await file.close() }
}
async function rootDirectory(root) {
  const absolute = path.resolve(root)
  const stat = await fs.lstat(absolute)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Experiment registration must be a regular directory')
  return await fs.realpath(absolute)
}
async function exists(root, relative) {
  try { await fs.lstat(path.join(root, relative)); return true } catch (error) { if (error.code === 'ENOENT') return false; throw error }
}
async function directoryJson(root, directory = '') {
  const target = directory ? path.join(root, directory) : root
  try {
    const stat = await fs.lstat(target)
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Unsafe artifact directory')
    const entries = await fs.readdir(target, { withFileTypes: true })
    if (entries.length > MAX_DIRECTORY_FILES) throw new Error('Experiment directory exceeds the file limit')
    const output = []
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (!entry.name.endsWith('.json') || SENSITIVE.test(entry.name)) continue
      try { output.push({ ...(await readJson(root, directory ? directory + '/' + entry.name : entry.name)), filename: entry.name }) } catch (error) { if (error.code !== 'ENOENT') continue }
    }
    return output
  } catch (error) { if (error.code === 'ENOENT') return []; throw error }
}
function legacySnapshot(raw, root) {
  if (!isRecord(raw.cases)) throw new Error('Invalid legacy case map')
  const cases = Object.entries(raw.cases).map(([id, record]) => {
    if (!isRecord(record)) throw new Error('Invalid legacy case')
    const lanes = Object.fromEntries(Object.entries(record).filter(([, value]) => isRecord(value) && OUTCOME_STATUSES.includes(value.status)))
    return { id: record.id || id, title: record.title || id, group: record.family || record.group, prompt: record.prompt, lanes }
  })
  const laneIds = [...new Set(cases.flatMap(record => Object.keys(record.lanes)))]
  const active = cases.flatMap(record => Object.entries(record.lanes).filter(([, outcome]) => outcome.status === 'running').map(([laneId]) => ({ caseId: record.id, laneId })))
  return { schemaVersion: 1, id: raw.id || path.basename(root), name: raw.name || raw.title || path.basename(root), status: raw.status || 'unknown', startedAt: raw.startedAt, updatedAt: raw.updatedAt, finishedAt: raw.finishedAt, metrics: raw.metrics, metadata: { ...raw.metadata, model: raw.model || raw.metadata?.model, runner: raw.runner || raw.metadata?.runner }, lanes: laneIds.map(id => ({ id, label: id })), cases, active }
}
function officialSnapshot(entries, root) {
  const results = entries.filter(entry => isRecord(entry.data) && entry.data.schemaVersion === 1 && typeof entry.data.caseId === 'string' && typeof entry.data.runner === 'string' && ['pass', 'fail', 'error'].includes(entry.data.status))
  if (!results.length) throw new Error('No supported experiment snapshot or harness results found')
  const caseMap = new Map()
  const evidence = new Map()
  for (const { data, mtime } of results.sort((left, right) => left.mtime.localeCompare(right.mtime))) {
    const lane = data.writable ? 'coding' : data.verdict || data.judgeVerdict ? 'review' : 'routing'
    if (!caseMap.has(data.caseId)) caseMap.set(data.caseId, { id: data.caseId, title: data.caseId, lanes: {} })
    caseMap.get(data.caseId).lanes[lane] = { ...data, diagnostics: data.violations || [] }
    evidence.set(JSON.stringify([data.caseId, lane]), data)
  }
  const laneIds = [...new Set([...caseMap.values()].flatMap(record => Object.keys(record.lanes)))]
  const models = [...new Set(results.map(entry => entry.data.model).filter(Boolean))]
  const runners = [...new Set(results.map(entry => entry.data.runner).filter(Boolean))]
  return { snapshot: { schemaVersion: 1, id: path.basename(root), name: path.basename(root), status: 'unknown', metadata: { model: models.join(', '), runner: runners.join(', ') }, lanes: laneIds.map(id => ({ id, label: id })), cases: [...caseMap.values()] }, evidence, mtime: results.at(-1).mtime }
}
async function source(root) {
  const directory = await rootDirectory(root)
  if (await exists(directory, 'experiment.json')) return { root: directory, source: 'generic', ...(await readJson(directory, 'experiment.json')) }
  if (await exists(directory, 'summary.json')) {
    const record = await readJson(directory, 'summary.json')
    const data = legacySnapshot(record.data, directory)
    if (await exists(directory, 'metrics.json')) {
      const companion = (await readJson(directory, 'metrics.json')).data
      if (!isRecord(companion) || !isRecord(companion.metrics)) throw new Error('Invalid producer metrics companion')
      data.metrics = { ...companion.metrics, sampledAt: companion.metrics.sampledAt || companion.updatedAt }
    }
    return { root: directory, source: 'legacy-summary', data, original: record.data, mtime: record.mtime }
  }
  const official = officialSnapshot(await directoryJson(directory), directory)
  return { root: directory, source: 'harness-results', data: official.snapshot, evidence: official.evidence, mtime: official.mtime }
}
export async function loadExperiment(root) {
  try {
    const record = await source(root)
    return normalizeExperiment(record.data, { root: record.root, source: record.source, mtime: record.mtime })
  } catch (error) { return errorExperiment(path.resolve(root), error.code ? `Cannot read experiment data (${error.code})` : error.message) }
}
function normalizeArtifacts(raw, label, notices) {
  const output = { responses: [], files: [], tools: [] }
  if (!isRecord(raw)) return output
  for (const [index, response] of (Array.isArray(raw.responses) ? raw.responses : []).slice(0, 200).entries()) {
    const text = typeof response === 'string' ? response : response?.text
    if (typeof text !== 'string') continue
    output.responses.push({ id: label + '-response-' + index, text: cleanText(text, MAX_TEXT_BYTES), ...(typeof response?.attemptId === 'string' ? { attemptId: cleanText(response.attemptId, 200) } : {}) })
  }
  for (const [index, file] of (Array.isArray(raw.files) ? raw.files : []).slice(0, 200).entries()) {
    if (!isRecord(file) || typeof file.path !== 'string' || typeof file.content !== 'string') continue
    const parts = file.path.split(/[\\/]/)
    if (path.isAbsolute(file.path) || parts.some(part => part === '..' || SENSITIVE.test(part)) || Buffer.byteLength(file.content) > MAX_TEXT_BYTES) { notices.push('An unsafe or oversized generated file was omitted'); continue }
    output.files.push({ id: label + '-file-' + index, path: cleanText(file.path, 500), content: cleanText(file.content, MAX_TEXT_BYTES), bytes: Buffer.byteLength(file.content), ...(typeof file.sha256 === 'string' ? { sha256: file.sha256 } : {}) })
  }
  for (const [index, tool] of (Array.isArray(raw.tools) ? raw.tools : []).slice(0, 1000).entries()) {
    if (!isRecord(tool) || typeof tool.name !== 'string') continue
    output.tools.push({ id: String(tool.id || label + '-tool-' + index), name: cleanText(tool.name, 200), ...(typeof tool.path === 'string' ? { path: cleanText(tool.path, 500) } : {}), ...(typeof tool.isError === 'boolean' ? { isError: tool.isError } : {}), ...(typeof tool.content === 'string' ? { content: cleanText(tool.content, MAX_TEXT_BYTES) } : {}) })
  }
  return output
}
function safeEvidence(value, depth = 0) {
  if (depth > 12) return '[nested data omitted]'
  if (typeof value === 'string') return cleanText(value, MAX_TEXT_BYTES)
  if (Array.isArray(value)) return value.slice(0, 2000).map(child => safeEvidence(child, depth + 1))
  if (!isRecord(value)) return value
  return Object.fromEntries(Object.entries(value).slice(0, 2000).map(([key, child]) => [key, /^(?:env|environment|password|credentials?|authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|secret|private[_-]?key)$/i.test(key) ? '[redacted]' : safeEvidence(child, depth + 1)]))
}
function combine(target, extra) { for (const key of ['responses', 'files', 'tools']) target[key].push(...extra[key]) }
export async function loadCaseDetail(root, caseId, laneId) {
  const record = await source(root)
  const experiment = normalizeExperiment(record.data, { root: record.root, source: record.source, mtime: record.mtime })
  const caseRecord = experiment.cases.find(record => record.id === caseId)
  if (!caseRecord || !Object.hasOwn(caseRecord.lanes, laneId)) return null
  const rawCase = record.data.cases.find(record => record.id === caseId)
  const rawOutcome = rawCase.lanes[laneId]
  const notices = []
  const output = normalizeArtifacts(rawOutcome, 'inline', notices)
  let evidence = null
  if (record.source === 'generic') {
    for (const artifactId of caseRecord.lanes[laneId].artifactIds || []) {
      if (!ARTIFACT_ID.test(artifactId) || SENSITIVE.test(artifactId + '.json')) { notices.push('An unsafe artifact reference was omitted'); continue }
      try {
        const artifact = (await readJson(record.root, 'artifacts/' + artifactId + '.json')).data
        if (!isRecord(artifact) || artifact.schemaVersion !== 1) { notices.push('A referenced artifact has an unsupported format'); continue }
        combine(output, normalizeArtifacts(artifact, artifactId, notices))
      } catch { notices.push('A referenced artifact is unavailable or unreadable') }
    }
    evidence = isRecord(rawOutcome.evidence) ? safeEvidence(rawOutcome.evidence) : null
  } else if (record.source === 'legacy-summary') {
    const originalCase = Object.values(record.original.cases).find(candidate => candidate.id === caseId) || record.original.cases[caseId]
    const legacyOutcome = originalCase?.[laneId]
    if (typeof legacyOutcome?.evidence === 'string' && legacyOutcome.evidence.startsWith('evidence/')) {
      try { evidence = (await readJson(record.root, legacyOutcome.evidence)).data } catch { notices.push('Evaluator evidence is unavailable') }
    }
    for (const entry of await directoryJson(record.root, 'generated-files')) {
      if (entry.data.caseId === caseId && entry.data.lane === laneId) combine(output, normalizeArtifacts(entry.data, entry.filename, notices))
    }
    for (const entry of (await directoryJson(record.root, 'agent-output')).sort((left, right) => String(left.data.startedAt).localeCompare(String(right.data.startedAt)))) {
      const capture = entry.data
      if (capture.caseId !== caseId || capture.lane !== laneId) continue
      combine(output, normalizeArtifacts({ responses: (capture.messages || []).map(message => ({ text: message.text, attemptId: capture.attemptId })), tools: capture.tools }, entry.filename, notices))
    }
  } else evidence = record.evidence.get(JSON.stringify([caseId, laneId])) || null
  if (evidence) evidence = safeEvidence(evidence)
  const structuredResponse = evidence ? Object.fromEntries(['selectedRouter', 'selectedSkills', 'selectedContext', 'decisions', 'specRouting'].filter(key => Object.hasOwn(evidence, key)).map(key => [key, evidence[key]])) : null
  return { experimentId: experiment.id, caseId, lane: laneId, title: caseRecord.title, prompt: caseRecord.prompt || null, outcome: caseRecord.lanes[laneId], ...output, structuredResponse, evidence, notices, responseNote: output.responses.length ? 'Retained visible agent responses. Internal reasoning is excluded.' : 'The original visible response was not retained or is unavailable. Recorded structured evaluator fields are shown separately when available.' }
}
