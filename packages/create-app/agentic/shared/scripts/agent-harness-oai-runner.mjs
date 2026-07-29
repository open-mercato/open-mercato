#!/usr/bin/env node

// One-shot harness runner for any OpenAI-compatible chat-completions endpoint.
//
// The Codex and Claude lanes delegate the agent loop to a trusted vendor CLI. This lane
// owns the loop directly so a raw model behind an OpenAI-compatible endpoint (OpenRouter,
// a vendor gateway, or a local llama.cpp/LM Studio server) can be measured on the same
// catalog. The contract with the evaluator is exactly the CLI contract: the process reads
// the prompt from stdin, reaches app content ONLY through the evaluator-owned harness MCP
// tool server, writes line-delimited trace events to stdout, and writes the final
// structured object to --output.
//
// The tool server is spawned with the exact command the evaluator supplies, so the
// env-cleared, path-validating, fail-closed file server stays the single filesystem
// capability. No shell, discovery, or network capability is exposed to the model.

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1'
const DEFAULT_MAX_STEPS = 40
const DEFAULT_REQUEST_TIMEOUT_MS = 300_000
const READ_TOOL = 'mcp__harness__read'
const WRITE_TOOL = 'mcp__harness__write'

function fail(message, code = 1) {
  process.stderr.write(`agent-harness-oai-runner: ${message}\n`)
  process.exit(code)
}

function parseArgs(argv) {
  const options = { maxSteps: DEFAULT_MAX_STEPS, requestTimeout: DEFAULT_REQUEST_TIMEOUT_MS, writable: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const value = () => {
      const next = argv[index + 1]
      if (next === undefined) throw new Error(`${arg} requires a value`)
      index += 1
      return next
    }
    if (arg === '--root') options.root = value()
    else if (arg === '--schema') options.schema = value()
    else if (arg === '--output') options.output = value()
    else if (arg === '--model') options.model = value()
    else if (arg === '--writable') options.writable = true
    else if (arg === '--tool-server') options.toolServer = JSON.parse(value())
    else if (arg === '--max-steps') options.maxSteps = Number.parseInt(value(), 10)
    else if (arg === '--request-timeout') options.requestTimeout = Number.parseInt(value(), 10)
    else throw new Error(`unknown argument ${arg}`)
  }
  if (!options.root || !path.isAbsolute(options.root)) throw new Error('--root must be an absolute path')
  if (!options.schema || !options.output) throw new Error('--schema and --output are required')
  if (!options.model) throw new Error('--model is required')
  if (!options.toolServer?.command || !Array.isArray(options.toolServer.args)) throw new Error('--tool-server must be JSON with command and args')
  if (!Number.isInteger(options.maxSteps) || options.maxSteps < 1 || options.maxSteps > 200) throw new Error('--max-steps must be an integer from 1 to 200')
  if (!Number.isInteger(options.requestTimeout) || options.requestTimeout < 1_000) throw new Error('--request-timeout must be at least 1000')
  return options
}

function emit(event) {
  process.stdout.write(`${JSON.stringify(event)}\n`)
}

function numberFromEnv(key) {
  const raw = process.env[key]
  if (raw === undefined || raw === '') return undefined
  const value = Number(raw)
  if (!Number.isFinite(value)) throw new Error(`${key} must be a number`)
  return value
}

function listFromEnv(key) {
  const raw = process.env[key]
  if (!raw) return undefined
  const entries = raw.split(',').map((entry) => entry.trim()).filter(Boolean)
  return entries.length ? entries : undefined
}

function booleanFromEnv(key) {
  const raw = process.env[key]
  if (raw === undefined || raw === '') return undefined
  if (['1', 'true', 'yes', 'on'].includes(raw.toLowerCase())) return true
  if (['0', 'false', 'no', 'off'].includes(raw.toLowerCase())) return false
  throw new Error(`${key} must be a boolean token`)
}

// Sampling stays unset unless the operator configures it: an unrequested default would
// silently differ from the model card the sweep is supposed to reproduce. Whatever is
// resolved here is echoed into the trace so a result file documents its own decoding.
function resolveSampling() {
  const sampling = {}
  const temperature = numberFromEnv('OM_OAI_TEMPERATURE')
  const topP = numberFromEnv('OM_OAI_TOP_P')
  const topK = numberFromEnv('OM_OAI_TOP_K')
  const minP = numberFromEnv('OM_OAI_MIN_P')
  const maxTokens = numberFromEnv('OM_OAI_MAX_TOKENS')
  const seed = numberFromEnv('OM_OAI_SEED')
  if (temperature !== undefined) sampling.temperature = temperature
  if (topP !== undefined) sampling.top_p = topP
  if (topK !== undefined) sampling.top_k = topK
  if (minP !== undefined) sampling.min_p = minP
  if (maxTokens !== undefined) sampling.max_tokens = maxTokens
  if (seed !== undefined) sampling.seed = seed
  return sampling
}

// Provider routing is body-only on OpenRouter. Without an explicit pin the gateway is free
// to move a sweep between hosts and quantizations mid-run, which makes per-case results
// incomparable, so the pin is emitted verbatim into the trace.
function resolveProviderRouting() {
  const order = listFromEnv('OM_OAI_PROVIDER_ORDER')
  const quantizations = listFromEnv('OM_OAI_QUANTIZATIONS')
  const allowFallbacks = booleanFromEnv('OM_OAI_ALLOW_FALLBACKS')
  const sort = process.env.OM_OAI_PROVIDER_SORT || undefined
  if (!order && !quantizations && allowFallbacks === undefined && !sort) return undefined
  return {
    ...(order ? { order } : {}),
    ...(quantizations ? { quantizations } : {}),
    ...(sort ? { sort } : {}),
    allow_fallbacks: allowFallbacks ?? false,
  }
}

function resolveReasoning() {
  const effort = process.env.OM_OAI_REASONING_EFFORT || undefined
  const exclude = booleanFromEnv('OM_OAI_REASONING_EXCLUDE')
  const maxTokens = numberFromEnv('OM_OAI_REASONING_MAX_TOKENS')
  if (!effort && exclude === undefined && maxTokens === undefined) return undefined
  return {
    ...(effort ? { effort } : {}),
    ...(maxTokens !== undefined ? { max_tokens: maxTokens } : {}),
    ...(exclude !== undefined ? { exclude } : {}),
  }
}

class ToolServer {
  constructor(toolServer) {
    this.child = spawn(toolServer.command, toolServer.args, { stdio: ['pipe', 'pipe', 'pipe'] })
    this.pending = new Map()
    this.nextId = 1
    this.buffer = ''
    this.stderr = ''
    this.child.stdout.setEncoding('utf8')
    this.child.stdout.on('data', (chunk) => this.consume(chunk))
    this.child.stderr.setEncoding('utf8')
    this.child.stderr.on('data', (chunk) => { this.stderr = `${this.stderr}${chunk}`.slice(-4096) })
    this.child.on('exit', (code) => {
      for (const [, entry] of this.pending) entry.reject(new Error(`harness tool server exited (${code}): ${this.stderr.trim()}`))
      this.pending.clear()
    })
  }

  consume(chunk) {
    this.buffer += chunk
    while (true) {
      const newline = this.buffer.indexOf('\n')
      if (newline < 0) break
      const line = this.buffer.slice(0, newline).replace(/\r$/, '')
      this.buffer = this.buffer.slice(newline + 1)
      if (!line.trim()) continue
      let message
      try { message = JSON.parse(line) } catch { continue }
      const entry = this.pending.get(message.id)
      if (!entry) continue
      this.pending.delete(message.id)
      if (message.error) entry.reject(new Error(message.error.message ?? 'harness tool server error'))
      else entry.resolve(message.result)
    }
  }

  request(method, params) {
    const id = this.nextId
    this.nextId += 1
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
    })
  }

  close() {
    this.child.stdin.end()
    this.child.kill()
  }
}

function toolDefinitions(serverTools, writable) {
  const byName = new Map(serverTools.map((tool) => [tool.name, tool]))
  const exposed = [['read', READ_TOOL], ...(writable ? [['write', WRITE_TOOL]] : [])]
  return exposed.map(([serverName, exposedName]) => {
    const tool = byName.get(serverName)
    if (!tool) throw new Error(`harness tool server does not expose ${serverName}`)
    return {
      type: 'function',
      function: {
        name: exposedName,
        description: tool.description,
        parameters: tool.inputSchema,
      },
    }
  })
}

function toolResultText(result) {
  const parts = Array.isArray(result?.content) ? result.content : []
  return parts.map((part) => (typeof part?.text === 'string' ? part.text : '')).join('\n')
}

function extractStructuredObject(content) {
  const trimmed = String(content ?? '').trim()
  if (!trimmed) throw new Error('model returned an empty final message')
  const candidates = [trimmed]
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced) candidates.push(fenced[1].trim())
  const first = trimmed.indexOf('{')
  const last = trimmed.lastIndexOf('}')
  if (first >= 0 && last > first) candidates.push(trimmed.slice(first, last + 1))
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
    } catch { /* try the next candidate shape */ }
  }
  throw new Error('model final message was not a JSON object')
}

// Provider failures are classified by the evaluator from this message, so keep the
// canonical wording it matches: retryable transport/rate-limit text stays distinct from
// terminal credential and quota text.
function providerFailure(status, body) {
  const head = String(body ?? '').replace(/\s+/g, ' ').trim().slice(0, 400)
  if (status === 401 || status === 403) return new Error(`provider authentication failed (HTTP ${status}): ${head}`)
  if (status === 402) return new Error(`provider quota exhausted (HTTP ${status}): ${head}`)
  if (status === 429) return new Error(`provider rate limit (HTTP 429): ${head}`)
  return new Error(`provider API error ${status}: ${head}`)
}

async function requestCompletion({ endpoint, apiKey, body, timeout }) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  let response
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error(`provider request timed out after ${timeout}ms`)
    throw new Error(`provider transport error: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    clearTimeout(timer)
  }
  const text = await response.text()
  if (!response.ok) throw providerFailure(response.status, text)
  let payload
  try { payload = JSON.parse(text) } catch { throw new Error('provider returned a non-JSON completion') }
  // OpenRouter reports upstream failures inside a 200 envelope.
  if (payload?.error) throw providerFailure(payload.error.code ?? payload.error.status ?? 502, payload.error.message ?? text)
  return payload
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const apiKey = process.env.OM_OAI_API_KEY
  if (!apiKey) throw new Error('missing api key: set OM_OAI_API_KEY for the OpenAI-compatible runner')
  const baseUrl = (process.env.OM_OAI_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '')
  const endpoint = `${baseUrl}/chat/completions`
  // Token/cost accounting is a gateway extension. A strict OpenAI-compatible server
  // rejects unrecognized top-level fields, so it is sent only where it is defined.
  const usageAccounting = booleanFromEnv('OM_OAI_USAGE_ACCOUNTING')
    ?? /(?:^|\.)openrouter\.ai$/.test(new URL(baseUrl).hostname)
  const schema = JSON.parse(fs.readFileSync(options.schema, 'utf8'))
  const prompt = fs.readFileSync(0, 'utf8')
  if (!prompt.trim()) throw new Error('runner received an empty prompt on stdin')

  const server = new ToolServer(options.toolServer)
  const sampling = resolveSampling()
  const providerRouting = resolveProviderRouting()
  const reasoning = resolveReasoning()
  let structuredOutputMode = booleanFromEnv('OM_OAI_DISABLE_RESPONSE_FORMAT') ? 'prompt' : 'json_schema'
  let servingProvider
  let steps = 0
  let toolCalls = 0
  let metadataEmitted = false
  const usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, reasoning_tokens: 0, cost: 0 }
  // Spend happens on every path, not only the successful one: a case that exhausts its step
  // budget or dies on a provider error has still consumed paid turns, and a sweep that sums
  // only successful cases under-counts exactly where models struggle. Emit the accounting
  // exactly once, whatever way the run ends.
  const emitProviderMetadata = () => {
    if (metadataEmitted) return
    metadataEmitted = true
    emit({ type: 'provider_metadata', provider: servingProvider ?? null, structuredOutput: structuredOutputMode, steps, toolCalls, usage })
  }

  try {
    await server.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'om-harness-oai-runner', version: '1.0.0' } })
    const listed = await server.request('tools/list', {})
    const tools = toolDefinitions(listed?.tools ?? [], options.writable)

    emit({
      type: 'session_start',
      runner: 'oai',
      model: options.model,
      endpoint: new URL(baseUrl).host,
      structuredOutput: structuredOutputMode,
      sampling,
      providerRouting: providerRouting ?? null,
      reasoning: reasoning ?? null,
      exposedTools: tools.map((tool) => tool.function.name),
    })

    const messages = [
      {
        role: 'system',
        content: 'You are an autonomous evaluation agent. The user message is the complete task contract; follow it exactly. '
          + `The supplied tools are your only way to reach any file: ${options.writable ? `${READ_TOOL} and ${WRITE_TOOL}` : READ_TOOL}. `
          + 'You have no shell, discovery, listing, search, or network capability. Where the contract says to call harness.read, call the supplied read tool. '
          + 'Continue calling tools until you can answer, then reply with the final JSON object and nothing else.',
      },
      { role: 'user', content: prompt },
    ]

    const callProvider = async (body) => {
      const payload = await requestCompletion({ endpoint, apiKey, body, timeout: options.requestTimeout })
      servingProvider = payload.provider ?? servingProvider
      if (payload.usage) {
        usage.prompt_tokens += payload.usage.prompt_tokens ?? 0
        usage.completion_tokens += payload.usage.completion_tokens ?? 0
        usage.total_tokens += payload.usage.total_tokens ?? 0
        usage.reasoning_tokens += payload.usage.completion_tokens_details?.reasoning_tokens ?? 0
        usage.cost += payload.usage.cost ?? 0
      }
      const choice = payload.choices?.[0]
      if (!choice) throw new Error('provider returned no completion choice')
      if (choice.finish_reason === 'length') throw new Error('provider truncated the completion (finish_reason=length); raise OM_OAI_MAX_TOKENS or lower the context')
      return choice.message ?? {}
    }

    const commonBody = () => ({
      model: options.model,
      ...sampling,
      ...(providerRouting ? { provider: providerRouting } : {}),
      ...(reasoning ? { reasoning } : {}),
      ...(usageAccounting ? { usage: { include: true } } : {}),
    })

    // Schema-constrained decoding and tool calling cannot share a turn: a server that
    // enforces `response_format` shapes the very first token stream into the answer object,
    // so the model can never emit a tool call and answers from the prompt alone. The tool
    // phase therefore runs unconstrained, and the schema is enforced on a final turn that
    // offers no tools.
    const finalizeStructuredObject = async () => {
      const request = {
        ...commonBody(),
        messages: [...messages, {
          role: 'user',
          content: 'Return the final structured object now: exactly one JSON object matching the required schema, with no prose, no code fences, and no further tool calls.',
        }],
      }
      if (structuredOutputMode === 'json_schema') {
        request.response_format = { type: 'json_schema', json_schema: { name: 'harness_response', strict: true, schema } }
      }
      let message
      try {
        message = await callProvider(request)
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        // Downgrade only on a client-side rejection of the field itself. A transient 429/5xx
        // whose body happens to mention "schema" must keep its retryable classification
        // instead of silently weakening structured output for the rest of the lane.
        const schemaRejected = /provider API error 4\d\d/.test(reason) && /response_format|json_schema|structured output|schema/i.test(reason)
        if (structuredOutputMode !== 'json_schema' || !schemaRejected) throw error
        structuredOutputMode = 'prompt'
        emit({ type: 'structured_output_downgrade', reason: reason.slice(0, 200) })
        delete request.response_format
        message = await callProvider(request)
      }
      return extractStructuredObject(message.content)
    }

    while (steps < options.maxSteps) {
      steps += 1
      const message = await callProvider({ ...commonBody(), messages, tools, tool_choice: 'auto' })
      const requested = Array.isArray(message.tool_calls) ? message.tool_calls : []
      // Thinking models interleave reasoning with tool calls, and the contract is to pass
      // the reasoning back unmodified in the assistant turn it arrived with. Dropping it
      // forces the model to re-derive its chain of thought after every tool result, which
      // systematically penalizes exactly the thinking candidates. OpenRouter carries it as
      // `reasoning_details`; llama.cpp/vLLM — the local re-measurement target — as a
      // `reasoning_content` string. Both shapes round-trip verbatim.
      messages.push({
        role: 'assistant',
        content: message.content ?? '',
        ...(Array.isArray(message.reasoning_details) && message.reasoning_details.length
          ? { reasoning_details: message.reasoning_details }
          : typeof message.reasoning_content === 'string' && message.reasoning_content
            ? { reasoning_content: message.reasoning_content }
            : {}),
        ...(requested.length ? { tool_calls: requested } : {}),
      })
      if (!requested.length) {
        const structured = await finalizeStructuredObject()
        emitProviderMetadata()
        fs.writeFileSync(options.output, `${JSON.stringify(structured)}\n`, { encoding: 'utf8', mode: 0o600 })
        emit({ type: 'result', structured_output: structured })
        return
      }
      for (const call of requested) {
        toolCalls += 1
        const name = call.function?.name ?? ''
        let args = {}
        let argumentError
        try { args = JSON.parse(call.function?.arguments || '{}') } catch (error) { argumentError = error instanceof Error ? error.message : String(error) }
        const serverTool = name === WRITE_TOOL ? 'write' : name === READ_TOOL ? 'read' : undefined
        let text
        let isError = false
        if (argumentError) {
          text = `tool arguments were not valid JSON: ${argumentError}`
          isError = true
        } else if (!serverTool) {
          text = `unknown tool ${name}`
          isError = true
        } else {
          const result = await server.request('tools/call', { name: serverTool, arguments: args })
          text = toolResultText(result)
          isError = result?.isError === true
        }
        emit({
          type: 'mcp_tool_call',
          id: call.id,
          server: 'harness',
          tool: serverTool ?? name,
          arguments: args,
          status: isError ? 'failed' : 'completed',
        })
        messages.push({ role: 'tool', tool_call_id: call.id, content: text })
      }
    }
    throw new Error(`runner exceeded its ${options.maxSteps}-step tool budget without a final answer`)
  } finally {
    emitProviderMetadata()
    server.close()
  }
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error), 1))
