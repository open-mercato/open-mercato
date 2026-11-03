#!/usr/bin/env node

import { spawn } from 'node:child_process'
import {
  closeSync,
  existsSync,
  lstatSync,
  openSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const MAX_PROTOCOL_BYTES = 25 * 1024 * 1024
const MAX_EXPORT_BYTES = 20 * 1024 * 1024
const THREAD_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function fail(message) {
  throw new Error(message)
}

function parseArguments(argumentsList) {
  const allowed = new Set(['thread-id', 'out'])
  const values = new Map()
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index]
    if (!argument.startsWith('--')) fail('Every argument must use a named --flag.')
    const key = argument.slice(2)
    if (!allowed.has(key)) fail(`Unknown argument: --${key}`)
    if (values.has(key)) fail(`Duplicate argument: --${key}`)
    const value = argumentsList[index + 1]
    if (!value || value.startsWith('--')) fail(`Missing value for --${key}.`)
    values.set(key, value)
    index += 1
  }
  for (const required of allowed) {
    if (!values.has(required)) fail(`Missing required argument: --${required}.`)
  }
  return Object.fromEntries(values)
}

function validateThread(thread, expectedThreadId) {
  if (!thread || typeof thread !== 'object' || Array.isArray(thread)) {
    fail('Codex app-server returned no thread object.')
  }
  const returnedIds = [thread.id, thread.sessionId].filter((value) => typeof value === 'string')
  if (!returnedIds.includes(expectedThreadId)) {
    fail('Codex app-server returned a different thread than requested.')
  }
  if (!Array.isArray(thread.turns) || thread.turns.length === 0) {
    fail('Codex app-server returned a thread without turns.')
  }
  return thread
}

function readThreadFromAppServer(threadId, timeoutMilliseconds = 30_000) {
  return new Promise((resolveThread, rejectThread) => {
    const server = spawn('codex', ['app-server', '--stdio'], {
      stdio: ['pipe', 'pipe', 'ignore'],
    })
    let settled = false
    let initialized = false
    let protocolBytes = 0
    let stdoutBuffer = ''

    const settle = (error, thread) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      server.stdin.end()
      if (server.exitCode === null && !server.killed) server.kill()
      if (error) rejectThread(error)
      else resolveThread(thread)
    }

    const send = (message) => {
      if (!server.stdin.destroyed) server.stdin.write(`${JSON.stringify(message)}\n`)
    }

    const handleMessage = (line) => {
      if (!line.trim()) return
      let message
      try {
        message = JSON.parse(line)
      } catch {
        settle(new Error('Codex app-server returned malformed JSON.'))
        return
      }

      if (message.id === 1) {
        if (message.error || !message.result || initialized) {
          settle(new Error('Codex app-server initialization failed.'))
          return
        }
        initialized = true
        send({ method: 'initialized', params: {} })
        send({ id: 2, method: 'thread/read', params: { threadId, includeTurns: true } })
        return
      }

      if (message.id === 2) {
        if (message.error) {
          settle(new Error('Codex app-server could not read the requested thread.'))
          return
        }
        try {
          settle(null, validateThread(message.result?.thread, threadId))
        } catch (error) {
          settle(error)
        }
      }
    }

    const timeout = setTimeout(() => {
      settle(new Error('Timed out while reading the Codex thread.'))
    }, timeoutMilliseconds)

    server.on('error', () => {
      settle(new Error('Could not start the Codex app-server.'))
    })
    server.stdin.on('error', () => {
      if (!settled) settle(new Error('Codex app-server closed its input before returning the thread.'))
    })
    server.on('close', () => {
      if (!settled) settle(new Error('Codex app-server exited before returning the thread.'))
    })
    server.stdout.setEncoding('utf8')
    server.stdout.on('data', (chunk) => {
      protocolBytes += Buffer.byteLength(chunk)
      if (protocolBytes > MAX_PROTOCOL_BYTES) {
        settle(new Error('Codex app-server response exceeds the allowed size.'))
        return
      }
      stdoutBuffer += chunk
      while (stdoutBuffer.includes('\n')) {
        const newlineIndex = stdoutBuffer.indexOf('\n')
        const line = stdoutBuffer.slice(0, newlineIndex)
        stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1)
        handleMessage(line)
        if (settled) return
      }
    })

    send({
      id: 1,
      method: 'initialize',
      params: {
        clientInfo: { name: 'om-share-this-session', version: '1.0.0' },
        capabilities: { experimentalApi: true },
      },
    })
  })
}

function writeExport(outputPath, thread) {
  const serialized = `${JSON.stringify(thread, null, 2)}\n`
  if (Buffer.byteLength(serialized) > MAX_EXPORT_BYTES) {
    fail('Codex thread export exceeds the allowed size.')
  }
  const descriptor = openSync(outputPath, 'wx', 0o600)
  let complete = false
  try {
    writeFileSync(descriptor, serialized, 'utf8')
    complete = true
  } finally {
    closeSync(descriptor)
    if (!complete && existsSync(outputPath)) unlinkSync(outputPath)
  }
}

export async function exportCodexSession({ threadId, outputPath }) {
  if (!THREAD_ID_PATTERN.test(threadId)) fail('Codex thread ID must be a UUID.')
  const resolvedOutputPath = resolve(outputPath)
  if (basename(resolvedOutputPath) === '.' || existsSync(resolvedOutputPath)) {
    fail('Output path already exists; use a new temporary file.')
  }
  const outputParent = dirname(resolvedOutputPath)
  let parentStat
  try {
    parentStat = lstatSync(outputParent)
    realpathSync(outputParent)
  } catch {
    fail('Output parent must be an existing real directory.')
  }
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) {
    fail('Output parent must be an existing real directory.')
  }

  const thread = await readThreadFromAppServer(threadId)
  writeExport(resolvedOutputPath, thread)
  return { turns: thread.turns.length }
}

async function main() {
  const argumentsMap = parseArguments(process.argv.slice(2))
  const result = await exportCodexSession({
    threadId: argumentsMap['thread-id'],
    outputPath: argumentsMap.out,
  })
  process.stdout.write(`${JSON.stringify({ status: 'exported', turns: result.turns })}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main()
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown Codex session-export failure.'
    process.stderr.write(`Codex session was not exported: ${message}\n`)
    process.exitCode = 1
  }
}
