import http from 'k6/http'
import { check } from 'k6'
import exec from 'k6/execution'
import { env, safetyErrorWindowMs, workload } from './config.js'
import { conflicts } from './metrics.js'
import { journeyContext } from './context.js'
import { authHeaders } from './session.js'
import { createErrorWindow, withQuery } from './pure/misc.js'

const SUCCESS = http.expectedStatuses({ min: 200, max: 399 })
const SUCCESS_OR_CONFLICT = http.expectedStatuses({ min: 200, max: 399 }, 409)

function responseCallbackFor(spec) {
  const accepted = Array.isArray(spec.accept) ? spec.accept : []
  if (accepted.some((status) => status !== 409)) throw new Error('[internal] only 409 can be accepted besides 2xx/3xx')
  return spec.conflict || accepted.length > 0 ? SUCCESS_OR_CONFLICT : SUCCESS
}

let errorWindow = null

function recordSafety(isError) {
  if (!env.safetyAbort) return
  if (!errorWindow) {
    errorWindow = createErrorWindow({
      windowMs: safetyErrorWindowMs(),
      maxErrorRate: Number(workload.safety.maxErrorRate ?? 0.2),
      minSamples: 30,
    })
  }
  const state = errorWindow(Date.now(), isError)
  if (state.tripped) {
    exec.test.abort(`[safety] error rate ${(state.rate * 100).toFixed(1)}% over the last ${workload.safety.errorWindow} on VU ${exec.vu.idInTest}`)
  }
}

function lookupPath(body, path) {
  return path.split('.').reduce((value, key) => (value === null || value === undefined ? undefined : value[key]), body)
}

export function jsonOf(response) {
  if (!response || !response.body) return null
  try {
    return response.json()
  } catch (error) {
    return null
  }
}

function shapeMatches(body, expect) {
  if (!expect) return true
  if (body === null || body === undefined) return false
  if (typeof expect === 'function') return Boolean(expect(body))
  if (expect === 'items') return Array.isArray(body.items)
  if (expect === 'results') return Array.isArray(body.results)
  if (expect === 'id') return typeof body.id === 'string' && body.id.length > 0
  if (expect === 'ok') return body.ok === true
  if (expect === 'object') return typeof body === 'object'
  const value = lookupPath(body, expect)
  return value !== undefined && value !== null
}

function requestTags(spec) {
  const context = journeyContext()
  return {
    group: spec.group || context.group,
    journey: spec.journey || context.journey,
    name: spec.name,
  }
}

function buildRequest(spec) {
  const method = spec.method || 'GET'
  const headers = { Accept: 'application/json', ...(spec.anonymous ? {} : authHeaders()), ...(spec.headers || {}) }
  let body = null
  if (spec.form) {
    body = spec.form
  } else if (spec.body !== undefined) {
    body = JSON.stringify(spec.body)
    headers['Content-Type'] = 'application/json'
  }
  return {
    method,
    url: `${env.baseUrl}${withQuery(spec.path, spec.query)}`,
    body,
    params: {
      headers,
      tags: requestTags(spec),
      timeout: spec.timeout || env.httpTimeout,
      responseCallback: responseCallbackFor(spec),
    },
  }
}

function evaluate(response, spec) {
  const tags = requestTags(spec)
  const status = response.status
  const isConflict = Boolean(spec.conflict) && status === 409
  const accepted = Array.isArray(spec.accept) && spec.accept.includes(status)
  const statusOk = (status >= 200 && status < 400) || isConflict || accepted
  let parsed
  const json = () => {
    if (parsed === undefined) parsed = jsonOf(response)
    return parsed
  }
  const shapeOk = !statusOk || isConflict || accepted ? statusOk : shapeMatches(json(), spec.expect)
  if (isConflict) conflicts.add(1, tags)
  const checkTags = { ...tags, strict: spec.strict === false ? '0' : '1' }
  check(response, {
    [`${spec.name} status`]: () => statusOk,
    [`${spec.name} shape`]: () => shapeOk,
  }, checkTags)
  recordSafety(!statusOk)
  return { name: spec.name, response, status, ok: statusOk && shapeOk && !isConflict && !accepted, conflict: isConflict, json }
}

export function request(spec) {
  const built = buildRequest(spec)
  const response = http.request(built.method, built.url, built.body, built.params)
  return evaluate(response, spec)
}

export function batch(specs) {
  const list = specs.filter(Boolean)
  if (list.length === 0) return {}
  const built = list.map(buildRequest)
  const responses = http.batch(built)
  const results = {}
  list.forEach((spec, index) => {
    const result = evaluate(responses[index], spec)
    if (results[spec.name]) {
      const existing = Array.isArray(results[spec.name]) ? results[spec.name] : [results[spec.name]]
      existing.push(result)
      results[spec.name] = existing
    } else {
      results[spec.name] = result
    }
  })
  return results
}

export function all(results, name) {
  const value = results[name]
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

export function get(path, query, name, expect, extra = {}) {
  return { method: 'GET', path, query, name, expect, ...extra }
}
