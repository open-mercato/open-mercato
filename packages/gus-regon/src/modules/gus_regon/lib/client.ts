import { fetchWithTimeout } from '@open-mercato/shared/lib/http/fetchWithTimeout'
import type { GusConfig } from './config'
import { readMethodResult } from './parser'

/**
 * Minimal BIR1.1 SOAP client (public API "UslugaBIRzewnPubl").
 *
 * Protocol notes (verified against the GUS test endpoint):
 * - SOAP 1.2 envelope, WS-Addressing `To`/`Action` headers, no `SOAPAction` HTTP header.
 * - `Zaloguj` returns a session id which is sent back as a plain HTTP header `sid`.
 * - Session should be closed with `Wyloguj`.
 */

const CONTRACT_NS = 'http://CIS/BIR/PUBL/2014/07/IUslugaBIRzewnPubl'
const BODY_NS = 'http://CIS/BIR/PUBL/2014/07'
const DATA_CONTRACT_NS = 'http://CIS/BIR/PUBL/2014/07/DataContract'

export const GUS_REQUEST_TIMEOUT_MS = 8_000

export type GusRequest = (url: string, init: RequestInit & { timeoutMs?: number }) => Promise<Response>

export class GusTransportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GusTransportError'
  }
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export function buildEnvelope(baseUrl: string, action: string, bodyXml: string): string {
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope" xmlns:wsa="http://www.w3.org/2005/08/addressing">',
    '<soap:Header>',
    `<wsa:To>${escapeXml(baseUrl)}</wsa:To>`,
    `<wsa:Action>${CONTRACT_NS}/${action}</wsa:Action>`,
    '</soap:Header>',
    `<soap:Body>${bodyXml}</soap:Body>`,
    '</soap:Envelope>',
  ].join('')
}

export type GusClient = {
  login(): Promise<string>
  searchByNip(sid: string, nip: string): Promise<string>
  logout(sid: string): Promise<void>
}

/**
 * Reads the response body through a reader owned by this call, so the deadline can
 * cancel it: cancelling the reader closes the stream and releases the connection,
 * which `response.body.cancel()` cannot do while `response.text()` holds the lock.
 */
async function readBodyUntil(response: Response, signal: AbortSignal, deadline: Promise<never>): Promise<string> {
  if (!response.body) return ''
  const reader = response.body.getReader()
  const onDeadline = () => {
    reader.cancel().catch(() => undefined)
  }
  signal.addEventListener('abort', onDeadline, { once: true })
  try {
    const decoder = new TextDecoder()
    let text = ''
    for (;;) {
      const chunk = await Promise.race([reader.read(), deadline])
      if (chunk.done) break
      text += decoder.decode(chunk.value, { stream: true })
    }
    return text + decoder.decode()
  } finally {
    signal.removeEventListener('abort', onDeadline)
    if (!signal.aborted) reader.releaseLock()
  }
}

/**
 * BIR1.1 SOAP client. Every call has one deadline for the whole exchange —
 * headers and body: `fetchWithTimeout` detaches the caller's signal once headers
 * arrive, so the body is read through an owned reader that the deadline cancels,
 * and a server that stalls mid-body can neither hang the call nor keep the
 * connection open.
 */
export function createGusClient(config: GusConfig, request: GusRequest = fetchWithTimeout): GusClient {
  async function call(action: string, bodyXml: string, sid?: string): Promise<string> {
    const controller = new AbortController()
    const deadline = new Promise<never>((_resolve, reject) => {
      controller.signal.addEventListener('abort', () => reject(new Error('deadline exceeded')), { once: true })
    })
    deadline.catch(() => undefined)
    const timer = setTimeout(() => controller.abort(), GUS_REQUEST_TIMEOUT_MS)
    try {
      const response = await Promise.race([
        request(config.baseUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/soap+xml; charset=utf-8',
            ...(sid ? { sid } : {}),
          },
          body: buildEnvelope(config.baseUrl, action, bodyXml),
          timeoutMs: GUS_REQUEST_TIMEOUT_MS,
          signal: controller.signal,
        }),
        deadline,
      ])
      const raw = await readBodyUntil(response, controller.signal, deadline)
      if (!response.ok) throw new GusTransportError(`[internal] GUS ${action} returned HTTP ${response.status}`)
      return raw
    } catch (error) {
      if (error instanceof GusTransportError) throw error
      const message = controller.signal.aborted
        ? `timed out after ${GUS_REQUEST_TIMEOUT_MS}ms`
        : error instanceof Error
          ? error.message
          : 'request error'
      throw new GusTransportError(`[internal] GUS ${action} request did not complete: ${message}`)
    } finally {
      clearTimeout(timer)
    }
  }

  return {
    async login() {
      const raw = await call(
        'Zaloguj',
        `<Zaloguj xmlns="${BODY_NS}"><pKluczUzytkownika>${escapeXml(config.apiKey)}</pKluczUzytkownika></Zaloguj>`,
      )
      const sid = readMethodResult(raw, 'Zaloguj').trim()
      if (!sid) throw new GusTransportError('[internal] GUS login returned no session id (invalid API key?)')
      return sid
    },

    async searchByNip(sid, nip) {
      const raw = await call(
        'DaneSzukajPodmioty',
        `<DaneSzukajPodmioty xmlns="${BODY_NS}"><pParametryWyszukiwania xmlns:dat="${DATA_CONTRACT_NS}"><dat:Nip>${escapeXml(nip)}</dat:Nip></pParametryWyszukiwania></DaneSzukajPodmioty>`,
        sid,
      )
      return readMethodResult(raw, 'DaneSzukajPodmioty')
    },

    async logout(sid) {
      await call(
        'Wyloguj',
        `<Wyloguj xmlns="${BODY_NS}"><pIdentyfikatorSesji>${escapeXml(sid)}</pIdentyfikatorSesji></Wyloguj>`,
        sid,
      )
    },
  }
}
