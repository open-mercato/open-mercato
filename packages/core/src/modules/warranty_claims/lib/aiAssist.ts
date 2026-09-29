import { generateObject, generateText } from 'ai'
import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import {
  AiModelFactoryError,
  createModelFactory,
  type AiModelFactory,
} from '@open-mercato/ai-assistant/modules/ai_assistant/lib/model-factory'
import {
  attachmentPartsToUiFileParts,
  resolveAttachmentParts,
} from '@open-mercato/ai-assistant/modules/ai_assistant/lib/attachment-parts'
import type { AiChatRequestContext } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/attachment-bridge-types'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { WarrantyClaim, WarrantyClaimEvent, WarrantyClaimLine } from '../data/entities'
import type {
  WarrantyClaimDisposition,
  WarrantyClaimEventKind,
  WarrantyClaimEventVisibility,
  WarrantyClaimLineStatus,
  WarrantyClaimPriority,
  WarrantyClaimStatus,
  WarrantyClaimType,
  WarrantyClaimWarrantyStatus,
} from '../data/validators'

const MODULE_ID = 'warranty_claims'
const AI_TIMEOUT_MS = 30_000

type GenerateTextModel = Parameters<typeof generateText>[0]['model']
type GenerateObjectModel = Parameters<typeof generateObject>[0]['model']
type GenerateObjectMessages = NonNullable<Parameters<typeof generateObject>[0]['messages']>

export class WarrantyAiNotConfiguredError extends Error {
  constructor() {
    super('LLM not configured')
    this.name = 'WarrantyAiNotConfiguredError'
  }
}

export class WarrantyAiUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WarrantyAiUnavailableError'
  }
}

export function isWarrantyAiUnavailableError(err: unknown): boolean {
  if (err instanceof WarrantyAiUnavailableError) return true
  if (typeof err !== 'object' || err === null) return false
  return (err as { name?: unknown }).name === 'WarrantyAiUnavailableError'
}

export type ClaimReplyTone = 'formal' | 'friendly' | 'concise'

export type ClaimReplyDraftInput = {
  em: EntityManager
  container: AwilixContainer
  scope: { tenantId: string; organizationId: string }
  claimId: string
  tone?: ClaimReplyTone
}

export type ClaimSummaryInput = Omit<ClaimReplyDraftInput, 'tone'>

export type WarrantyDamagePhotoAssessment = {
  damageType: string
  severity: 'minor' | 'moderate' | 'severe' | 'unknown'
  probableCause: string
  misuseSuspected: boolean
  confidence: number
  summary: string
}

export type WarrantyProofOfPurchaseExtraction = {
  purchaseDate: string | null
  serialNumber: string | null
  amount: string | null
  currency: string | null
  merchant: string | null
  confidence: number
}

export type AssessDamagePhotoInput = {
  em: EntityManager
  container: AwilixContainer
  scope: { tenantId: string; organizationId: string }
  claimId: string
  lineId: string
  attachmentId: string
  authContext: AiChatRequestContext
}

export type ExtractProofOfPurchaseInput = {
  em: EntityManager
  container: AwilixContainer
  scope: { tenantId: string; organizationId: string }
  attachmentId: string
  authContext: AiChatRequestContext
}

export type ClaimPromptLineFacts = {
  productName: string | null
  sku: string | null
  serialNumber: string | null
  lineStatus: WarrantyClaimLineStatus
  disposition: WarrantyClaimDisposition | null
  qtyClaimed: string | null
  qtyApproved: string | null
  warrantyStatus: WarrantyClaimWarrantyStatus
}

export type ClaimPromptTimelineEntry = {
  kind: WarrantyClaimEventKind
  visibility: WarrantyClaimEventVisibility
  body: string | null
  createdAt: string | null
}

export type ClaimPromptFacts = {
  claimNumber: string
  status: WarrantyClaimStatus
  claimType: WarrantyClaimType
  priority: WarrantyClaimPriority
  reasonCode: string | null
  rejectionReasonCode: string | null
  customerName: string | null
  contactName: string | null
  resolutionSummary: string | null
  totals: {
    currencyCode: string | null
    claimedAmount: string | null
    approvedAmount: string | null
    recoveredAmount: string | null
  }
  lines: ClaimPromptLineFacts[]
  timeline: ClaimPromptTimelineEntry[]
  tone?: ClaimReplyTone
}

export type ClaimPromptFactsInput = {
  claim: WarrantyClaim
  lines: WarrantyClaimLine[]
  timelineEvents: WarrantyClaimEvent[]
  tone?: ClaimReplyTone
}

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function nullableString(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null
  const text = String(value).trim()
  return text.length > 0 ? text : null
}

function sortTimeline(events: ClaimPromptTimelineEntry[]): ClaimPromptTimelineEntry[] {
  return events
    .slice()
    .sort((a, b) => {
      const aTime = a.createdAt ? new Date(a.createdAt).getTime() : Number.POSITIVE_INFINITY
      const bTime = b.createdAt ? new Date(b.createdAt).getTime() : Number.POSITIVE_INFINITY
      return aTime - bTime
    })
}

function serializeLine(line: WarrantyClaimLine): ClaimPromptLineFacts {
  return {
    productName: nullableString(line.productName),
    sku: nullableString(line.sku),
    serialNumber: nullableString(line.serialNumber),
    lineStatus: line.lineStatus,
    disposition: line.disposition ?? null,
    qtyClaimed: nullableString(line.qtyClaimed),
    qtyApproved: nullableString(line.qtyApproved),
    warrantyStatus: line.warrantyStatus,
  }
}

function serializeTimelineEvent(event: WarrantyClaimEvent): ClaimPromptTimelineEntry {
  return {
    kind: event.kind,
    visibility: event.visibility,
    body: nullableString(event.body),
    createdAt: toIso(event.createdAt),
  }
}

export function buildClaimPromptFacts(input: ClaimPromptFactsInput): ClaimPromptFacts {
  return {
    claimNumber: input.claim.claimNumber,
    status: input.claim.status,
    claimType: input.claim.claimType,
    priority: input.claim.priority,
    reasonCode: nullableString(input.claim.reasonCode),
    rejectionReasonCode: nullableString(input.claim.rejectionReasonCode),
    customerName: nullableString(input.claim.customerName),
    contactName: null,
    resolutionSummary: nullableString(input.claim.resolutionSummary),
    totals: {
      currencyCode: nullableString(input.claim.currencyCode),
      claimedAmount: nullableString(input.claim.totalClaimedAmount),
      approvedAmount: nullableString(input.claim.totalApprovedAmount),
      recoveredAmount: nullableString(input.claim.totalRecoveredAmount),
    },
    lines: input.lines.map(serializeLine),
    timeline: sortTimeline(input.timelineEvents.map(serializeTimelineEvent)),
    tone: input.tone,
  }
}

function toneInstruction(tone: ClaimReplyTone | undefined): string {
  switch (tone) {
    case 'friendly':
      return 'Use a friendly, reassuring tone.'
    case 'concise':
      return 'Use a concise, direct tone.'
    case 'formal':
    default:
      return 'Use a formal, professional tone.'
  }
}

function promptJson(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

const damagePhotoAssessmentSchema = z.object({
  damageType: z.string().trim().min(1).max(200),
  severity: z.enum(['minor', 'moderate', 'severe', 'unknown']),
  probableCause: z.string().trim().min(1).max(1000),
  misuseSuspected: z.boolean(),
  confidence: z.number().min(0).max(1),
  summary: z.string().trim().min(1).max(1500),
}).strict()

const proofOfPurchaseExtractionSchema = z.object({
  purchaseDate: z.string().trim().min(1).max(40).nullable(),
  serialNumber: z.string().trim().min(1).max(191).nullable(),
  amount: z.string().trim().min(1).max(80).nullable(),
  currency: z.string().trim().min(1).max(12).nullable(),
  merchant: z.string().trim().min(1).max(300).nullable(),
  confidence: z.number().min(0).max(1),
}).strict()

function terminalStatus(status: WarrantyClaimStatus): boolean {
  return status === 'resolved' || status === 'closed' || status === 'rejected' || status === 'cancelled'
}

export function assembleClaimReplyPrompt(claim: ClaimPromptFacts): { system: string; prompt: string } {
  const customerTimeline = claim.timeline.filter((entry) => entry.visibility === 'customer')
  const latestCustomerMessage = customerTimeline
    .slice()
    .reverse()
    .find((entry) => entry.body)

  return {
    system: [
      'You are a warranty-desk assistant writing on behalf of the merchant.',
      'Match the language of the customer\'s latest message when present.',
      'Be factual, cite the claim number, and never invent commitments, refund amounts, replacement dates, shipping dates, or deadlines not present in the facts.',
      'Keep the reply to about 150 words. Do not use markdown headers.',
      toneInstruction(claim.tone),
    ].join(' '),
    prompt: [
      `Draft a customer-facing reply for warranty claim ${claim.claimNumber}.`,
      latestCustomerMessage?.body
        ? `Customer's latest visible message: ${latestCustomerMessage.body}`
        : 'No customer message body is available; use the claim facts only.',
      'Use only these customer-visible facts:',
      promptJson({
        claimNumber: claim.claimNumber,
        status: claim.status,
        claimType: claim.claimType,
        priority: claim.priority,
        reasonCode: claim.reasonCode,
        rejectionReasonCode: claim.rejectionReasonCode,
        customerName: claim.customerName,
        contactName: claim.contactName,
        resolutionSummary: claim.resolutionSummary,
        totals: claim.totals,
        lines: claim.lines,
        timeline: customerTimeline,
      }),
    ].join('\n\n'),
  }
}

export function assembleClaimSummaryPrompt(claim: ClaimPromptFacts): { system: string; prompt: string } {
  return {
    system: [
      'You summarize warranty and RMA claims for an internal operator.',
      'Write plain text in 120 words or fewer.',
      'Include customer-visible and internal timeline facts when they are provided.',
      'Be factual, cite the claim number, and do not invent amounts, dates, or commitments.',
      'When unresolved items exist, end with "Open questions:" followed by a bullet list.',
    ].join(' '),
    prompt: [
      `Summarize warranty claim ${claim.claimNumber}.`,
      terminalStatus(claim.status)
        ? 'The claim is in a terminal status; include open questions only if the facts still show unresolved items.'
        : 'The claim is not terminal; identify unresolved items and end with Open questions.',
      'Use these facts:',
      promptJson({
        claimNumber: claim.claimNumber,
        status: claim.status,
        claimType: claim.claimType,
        priority: claim.priority,
        reasonCode: claim.reasonCode,
        rejectionReasonCode: claim.rejectionReasonCode,
        customerName: claim.customerName,
        contactName: claim.contactName,
        resolutionSummary: claim.resolutionSummary,
        totals: claim.totals,
        lines: claim.lines,
        timeline: claim.timeline,
      }),
    ].join('\n\n'),
  }
}

async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs)
  })

  try {
    return await Promise.race([operation, timeoutPromise])
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle)
    }
  }
}

function isAiModelFactoryError(err: unknown): boolean {
  if (err instanceof AiModelFactoryError) return true
  if (typeof err !== 'object' || err === null) return false
  return (err as { name?: unknown }).name === 'AiModelFactoryError'
}

export function isWarrantyAiNotConfiguredError(err: unknown): boolean {
  if (err instanceof WarrantyAiNotConfiguredError) return true
  if (typeof err !== 'object' || err === null) return false
  return (err as { name?: unknown }).name === 'WarrantyAiNotConfiguredError'
}

function resolveWarrantyModel(container: AwilixContainer): GenerateTextModel {
  let factory: AiModelFactory
  try {
    factory = createModelFactory(container)
  } catch {
    throw new WarrantyAiNotConfiguredError()
  }
  try {
    const resolution = factory.resolveModel({ moduleId: MODULE_ID })
    return resolution.model as GenerateTextModel
  } catch (err) {
    if (isAiModelFactoryError(err)) {
      throw new WarrantyAiNotConfiguredError()
    }
    throw err
  }
}

function resolveWarrantyObjectModel(container: AwilixContainer): GenerateObjectModel {
  return resolveWarrantyModel(container) as GenerateObjectModel
}

async function buildAttachmentMessages(input: {
  container: AwilixContainer
  attachmentId: string
  authContext: AiChatRequestContext
  acceptedMediaTypes: readonly ['image'] | readonly ['image', 'pdf']
  prompt: string
}): Promise<GenerateObjectMessages> {
  const parts = await resolveAttachmentParts({
    attachmentIds: [input.attachmentId],
    authContext: input.authContext,
    acceptedMediaTypes: input.acceptedMediaTypes,
    container: input.container,
  })
  const fileParts = attachmentPartsToUiFileParts(parts)
  if (fileParts.length === 0) {
    throw new WarrantyAiUnavailableError('[internal] warranty ai attachment content unavailable')
  }
  return [
    {
      role: 'user',
      content: [
        { type: 'text', text: input.prompt },
        ...fileParts,
      ],
    },
  ] as GenerateObjectMessages
}

async function generateWarrantyObject<T extends Record<string, unknown>>(input: {
  model: GenerateObjectModel
  container: AwilixContainer
  schema: z.ZodType<T>
  system: string
  prompt: string
  attachmentId: string
  authContext: AiChatRequestContext
  acceptedMediaTypes: readonly ['image'] | readonly ['image', 'pdf']
}): Promise<T> {
  const messages = await buildAttachmentMessages({
    container: input.container,
    attachmentId: input.attachmentId,
    authContext: input.authContext,
    acceptedMediaTypes: input.acceptedMediaTypes,
    prompt: input.prompt,
  })
  try {
    const result = await withTimeout(
      generateObject({
        model: input.model,
        schema: input.schema,
        system: input.system,
        messages,
        temperature: 0,
      }),
      AI_TIMEOUT_MS,
      `[internal] warranty claims ai timed out after ${AI_TIMEOUT_MS}ms`,
    )
    return result.object
  } catch (err) {
    if (isWarrantyAiUnavailableError(err)) throw err
    throw new WarrantyAiUnavailableError(err instanceof Error ? err.message : '[internal] warranty ai call failed')
  }
}

async function loadDamageAssessmentFacts(input: AssessDamagePhotoInput): Promise<{
  claim: WarrantyClaim
  line: WarrantyClaimLine
}> {
  const claim = await findOneWithDecryption(
    input.em,
    WarrantyClaim,
    {
      id: input.claimId,
      tenantId: input.scope.tenantId,
      organizationId: input.scope.organizationId,
      deletedAt: null,
    },
    {},
    input.scope,
  )
  if (!claim) {
    throw new CrudHttpError(404, { error: 'warranty_claims.errors.notFound' })
  }
  const line = await findOneWithDecryption(
    input.em,
    WarrantyClaimLine,
    {
      id: input.lineId,
      claim: claim.id,
      tenantId: input.scope.tenantId,
      organizationId: input.scope.organizationId,
      deletedAt: null,
    },
    {},
    input.scope,
  )
  if (!line) {
    throw new CrudHttpError(404, { error: 'warranty_claims.errors.notFound' })
  }
  return { claim, line }
}

async function loadClaimPromptFacts(input: {
  em: EntityManager
  scope: { tenantId: string; organizationId: string }
  claimId: string
  visibility?: WarrantyClaimEventVisibility
  tone?: ClaimReplyTone
}): Promise<ClaimPromptFacts> {
  const claim = await findOneWithDecryption(
    input.em,
    WarrantyClaim,
    {
      id: input.claimId,
      tenantId: input.scope.tenantId,
      organizationId: input.scope.organizationId,
      deletedAt: null,
    },
    {},
    input.scope,
  )
  if (!claim) {
    throw new CrudHttpError(404, { error: 'warranty_claims.errors.notFound' })
  }

  const eventWhere: {
    claim: string
    tenantId: string
    organizationId: string
    visibility?: WarrantyClaimEventVisibility
  } = {
    claim: claim.id,
    tenantId: input.scope.tenantId,
    organizationId: input.scope.organizationId,
  }
  if (input.visibility) {
    eventWhere.visibility = input.visibility
  }

  const [lines, timelineEvents] = await Promise.all([
    findWithDecryption(
      input.em,
      WarrantyClaimLine,
      {
        claim: claim.id,
        tenantId: input.scope.tenantId,
        organizationId: input.scope.organizationId,
        deletedAt: null,
      },
      { orderBy: { lineNo: 'ASC' } },
      input.scope,
    ),
    findWithDecryption(
      input.em,
      WarrantyClaimEvent,
      eventWhere,
      { orderBy: { createdAt: 'ASC' } },
      input.scope,
    ),
  ])

  return buildClaimPromptFacts({
    claim,
    lines,
    timelineEvents,
    tone: input.tone,
  })
}

async function generateWarrantyText(input: {
  container: AwilixContainer
  system: string
  prompt: string
  emptyMessage: string
}): Promise<string> {
  const model = resolveWarrantyModel(input.container)
  let text: string
  try {
    const result = await withTimeout(
      generateText({
        model,
        system: input.system,
        prompt: input.prompt,
        temperature: 0.3,
      }),
      AI_TIMEOUT_MS,
      `[internal] warranty claims ai timed out after ${AI_TIMEOUT_MS}ms`,
    )
    text = result.text
  } catch (err) {
    throw new WarrantyAiUnavailableError(err instanceof Error ? err.message : '[internal] warranty ai call failed')
  }
  const trimmed = text.trim()
  if (!trimmed) {
    throw new WarrantyAiUnavailableError(input.emptyMessage)
  }
  return trimmed
}

export async function assessDamagePhoto(input: AssessDamagePhotoInput): Promise<WarrantyDamagePhotoAssessment> {
  const model = resolveWarrantyObjectModel(input.container)
  const { claim, line } = await loadDamageAssessmentFacts(input)
  const system = [
    'You are a warranty damage assessor reviewing customer-submitted claim photos.',
    'Use only visible evidence and the provided claim-line facts.',
    'Never invent monetary amounts, credit amounts, refund amounts, fees, or replacement commitments.',
    'If the image is unclear, set severity to unknown and lower confidence.',
  ].join(' ')
  const prompt = [
    'Assess the attached damage photo for the warranty claim line.',
    'Return concise structured facts only.',
    'Claim and line facts:',
    promptJson({
      claimId: claim.id,
      claimNumber: claim.claimNumber,
      claimType: claim.claimType,
      claimStatus: claim.status,
      lineId: line.id,
      productName: nullableString(line.productName),
      sku: nullableString(line.sku),
      serialNumber: nullableString(line.serialNumber),
      faultCode: nullableString(line.faultCode),
      faultDescription: nullableString(line.faultDescription),
      warrantyStatus: line.warrantyStatus,
    }),
  ].join('\n\n')
  return generateWarrantyObject({
    model,
    container: input.container,
    schema: damagePhotoAssessmentSchema,
    system,
    prompt,
    attachmentId: input.attachmentId,
    authContext: input.authContext,
    acceptedMediaTypes: ['image'],
  })
}

export async function extractProofOfPurchase(input: ExtractProofOfPurchaseInput): Promise<WarrantyProofOfPurchaseExtraction> {
  const model = resolveWarrantyObjectModel(input.container)
  const system = [
    'You extract proof-of-purchase facts for a warranty desk from receipts, invoices, or order confirmations.',
    'Use only facts visible in the attached image or PDF.',
    'Return monetary amount as a string exactly as represented when possible; never coerce it into a numeric money mutation.',
    'Use null for missing or unreadable fields and lower confidence when uncertain.',
  ].join(' ')
  const prompt = [
    'Extract proof-of-purchase facts from the attached document.',
    'For purchaseDate, prefer ISO YYYY-MM-DD when the date is unambiguous; otherwise return the visible date string or null.',
    'For currency, prefer an ISO currency code when visible or clearly implied; otherwise return null.',
  ].join('\n\n')
  return generateWarrantyObject({
    model,
    container: input.container,
    schema: proofOfPurchaseExtractionSchema,
    system,
    prompt,
    attachmentId: input.attachmentId,
    authContext: input.authContext,
    acceptedMediaTypes: ['image', 'pdf'],
  })
}

export async function buildClaimReplyDraft(input: ClaimReplyDraftInput): Promise<{ draft: string }> {
  const facts = await loadClaimPromptFacts({
    em: input.em,
    scope: input.scope,
    claimId: input.claimId,
    visibility: 'customer',
    tone: input.tone,
  })
  const { system, prompt } = assembleClaimReplyPrompt(facts)
  return {
    draft: await generateWarrantyText({
      container: input.container,
      system,
      prompt,
      emptyMessage: '[internal] empty ai draft',
    }),
  }
}

export async function buildClaimSummary(input: ClaimSummaryInput): Promise<{ summary: string }> {
  const facts = await loadClaimPromptFacts({
    em: input.em,
    scope: input.scope,
    claimId: input.claimId,
  })
  const { system, prompt } = assembleClaimSummaryPrompt(facts)
  return {
    summary: await generateWarrantyText({
      container: input.container,
      system,
      prompt,
      emptyMessage: '[internal] empty ai draft',
    }),
  }
}
