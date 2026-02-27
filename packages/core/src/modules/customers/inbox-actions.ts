import type { InboxActionDefinition, InboxActionExecutionContext } from '@open-mercato/shared/modules/inbox-actions'
import {
  createContactPayloadSchema,
  linkContactPayloadSchema,
  logActivityPayloadSchema,
  draftReplyPayloadSchema,
} from '../inbox_ops/data/validators'
import type {
  CreateContactPayload,
  LinkContactPayload,
  LogActivityPayload,
  DraftReplyPayload,
} from '../inbox_ops/data/validators'
import {
  asHelperContext,
  ExecutionError,
  executeCommand,
  resolveEntityClass,
  resolveCustomerEntityIdByEmail,
  resolveContactIdByNameAndType,
} from '../inbox_ops/lib/executionHelpers'
import { splitPersonName } from '../inbox_ops/lib/contactValidation'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'

// ---------------------------------------------------------------------------
// create_contact
// ---------------------------------------------------------------------------

async function executeCreateContactAction(
  action: { id: string; proposalId: string; payload: unknown },
  ctx: InboxActionExecutionContext,
): Promise<{ createdEntityId?: string | null; createdEntityType?: string | null; matchedEntityId?: string | null; matchedEntityType?: string | null }> {
  const hCtx = asHelperContext(ctx)
  const payload = action.payload as CreateContactPayload

  const CustomerEntityClass = resolveEntityClass(hCtx, 'CustomerEntity')
  if (payload.email && CustomerEntityClass) {
    const emailLower = payload.email.trim().toLowerCase()
    let existingContact = await findOneWithDecryption(
      hCtx.em,
      CustomerEntityClass,
      {
        primaryEmail: emailLower,
        tenantId: hCtx.tenantId,
        organizationId: hCtx.organizationId,
        deletedAt: null,
      },
      undefined,
      { tenantId: hCtx.tenantId, organizationId: hCtx.organizationId },
    )
    if (!existingContact) {
      const candidates = await findWithDecryption(
        hCtx.em,
        CustomerEntityClass,
        {
          tenantId: hCtx.tenantId,
          organizationId: hCtx.organizationId,
          deletedAt: null,
        },
        { limit: 100, orderBy: { createdAt: 'DESC' } },
        { tenantId: hCtx.tenantId, organizationId: hCtx.organizationId },
      )
      existingContact = candidates.find(
        (e) => e.primaryEmail && e.primaryEmail.toLowerCase() === emailLower,
      ) ?? null
    }
    if (existingContact) {
      const isCompany = existingContact.kind === 'company'
      return {
        createdEntityId: existingContact.id,
        createdEntityType: isCompany ? 'customer_company' : 'customer_person',
        matchedEntityId: existingContact.id,
        matchedEntityType: isCompany ? 'company' : 'person',
      }
    }
  }

  if (payload.type === 'company') {
    const result = await executeCommand<Record<string, unknown>, { entityId?: string }>(
      hCtx,
      'customers.companies.create',
      {
        organizationId: hCtx.organizationId,
        tenantId: hCtx.tenantId,
        displayName: payload.name,
        legalName: payload.companyName ?? payload.name,
        primaryEmail: payload.email,
        primaryPhone: payload.phone,
        source: payload.source,
      },
    )
    if (!result.entityId) {
      throw new ExecutionError('Company creation did not return an entity ID', 500)
    }
    return { createdEntityId: result.entityId, createdEntityType: 'customer_company' }
  }

  const { firstName, lastName } = splitPersonName(payload.name, payload.email)
  const result = await executeCommand<Record<string, unknown>, { entityId?: string }>(
    hCtx,
    'customers.people.create',
    {
      organizationId: hCtx.organizationId,
      tenantId: hCtx.tenantId,
      displayName: payload.name,
      firstName,
      lastName,
      primaryEmail: payload.email,
      primaryPhone: payload.phone,
      jobTitle: payload.role,
      source: payload.source,
    },
  )

  if (!result.entityId) {
    throw new ExecutionError('Person creation did not return an entity ID', 500)
  }

  return { createdEntityId: result.entityId, createdEntityType: 'customer_person' }
}

// ---------------------------------------------------------------------------
// link_contact
// ---------------------------------------------------------------------------

function executeLinkContactAction(
  action: { id: string; proposalId: string; payload: unknown },
): { createdEntityId?: string | null; createdEntityType?: string | null; matchedEntityId?: string | null; matchedEntityType?: string | null } {
  const payload = action.payload as LinkContactPayload
  return {
    createdEntityId: payload.contactId,
    createdEntityType: payload.contactType === 'company' ? 'customer_company' : 'customer_person',
    matchedEntityId: payload.contactId,
    matchedEntityType: payload.contactType,
  }
}

// ---------------------------------------------------------------------------
// log_activity
// ---------------------------------------------------------------------------

async function executeLogActivityAction(
  action: { id: string; proposalId: string; payload: unknown },
  ctx: InboxActionExecutionContext,
): Promise<{ createdEntityId?: string | null; createdEntityType?: string | null }> {
  const hCtx = asHelperContext(ctx)
  let payload = action.payload as LogActivityPayload

  if (!payload.contactId) {
    const resolved = await resolveContactIdByNameAndType(hCtx, payload.contactName, payload.contactType)
    if (resolved) {
      payload = { ...payload, contactId: resolved }
    } else {
      throw new ExecutionError(
        `log_activity requires contactId — could not resolve contact "${payload.contactName}" (${payload.contactType})`,
        400,
      )
    }
  }

  const result = await executeCommand<Record<string, unknown>, { activityId?: string }>(
    hCtx,
    'customers.activities.create',
    {
      organizationId: hCtx.organizationId,
      tenantId: hCtx.tenantId,
      entityId: payload.contactId,
      activityType: payload.activityType,
      subject: payload.subject,
      body: payload.body,
      authorUserId: hCtx.userId,
    },
  )

  if (!result.activityId) {
    throw new ExecutionError('Activity creation did not return an activity ID', 500)
  }

  return { createdEntityId: result.activityId, createdEntityType: 'customer_activity' }
}

// ---------------------------------------------------------------------------
// draft_reply
// ---------------------------------------------------------------------------

async function executeDraftReplyAction(
  action: { id: string; proposalId: string; payload: unknown },
  ctx: InboxActionExecutionContext,
): Promise<{ createdEntityId?: string | null; createdEntityType?: string | null }> {
  const hCtx = asHelperContext(ctx)
  const payload = action.payload as DraftReplyPayload
  const payloadRecord = action.payload as Record<string, unknown>
  const explicitContactId = typeof payloadRecord.contactId === 'string' ? payloadRecord.contactId : null
  const contactId = explicitContactId ?? (await resolveCustomerEntityIdByEmail(hCtx, payload.to))

  if (!contactId) {
    throw new ExecutionError(
      `No matching contact found for "${payload.to}". Create the contact first or link an existing one.`,
      400,
    )
  }

  const details = [
    payload.body.trim(),
    '',
    '---',
    `Draft reply target: ${payload.to}`,
    `Subject: ${payload.subject}`,
    payload.context ? `Context: ${payload.context}` : null,
    `InboxOps Proposal: ${action.proposalId}`,
    `InboxOps Action: ${action.id}`,
  ]
    .filter((line) => typeof line === 'string' && line.length > 0)
    .join('\n')

  const result = await executeCommand<Record<string, unknown>, { activityId?: string }>(
    hCtx,
    'customers.activities.create',
    {
      organizationId: hCtx.organizationId,
      tenantId: hCtx.tenantId,
      entityId: contactId,
      activityType: 'email',
      subject: payload.subject,
      body: details,
      authorUserId: hCtx.userId,
    },
  )

  if (!result.activityId) {
    throw new ExecutionError('Draft reply activity did not return an activity ID', 500)
  }

  return { createdEntityId: result.activityId, createdEntityType: 'customer_activity' }
}

// ---------------------------------------------------------------------------
// Exported action definitions
// ---------------------------------------------------------------------------

export const inboxActions: InboxActionDefinition[] = [
  {
    type: 'create_contact',
    requiredFeature: 'customers.people.manage',
    payloadSchema: createContactPayloadSchema,
    label: 'Create Contact',
    promptSchema: `create_contact payload:
{ type: "person"|"company", name: string, email?: string, phone?: string, companyName?: string, role?: string, source: "inbox_ops" }`,
    promptRules: [
      'For create_contact: always include email when available from the thread. Set source to "inbox_ops", type must be lowercase "person" or "company".',
      'For create_contact with type "person": if the sender\'s display name is not available in the email header or signature, attempt to derive a human-readable name from the email address (e.g., john.doe@company.com -> "John Doe", m.smith@corp.net -> "M Smith"). If the email address does not contain a derivable name (e.g., info@, noreply@), use the full email address as the name. Always aim to provide both a first and last name when possible.',
    ],
    execute: executeCreateContactAction,
  },
  {
    type: 'link_contact',
    requiredFeature: 'customers.people.manage',
    payloadSchema: linkContactPayloadSchema,
    label: 'Link Contact',
    promptSchema: `link_contact payload:
{ emailAddress: string (email), contactId: uuid, contactType: "person"|"company", contactName: string }`,
    execute: (action) => Promise.resolve(executeLinkContactAction(action)),
  },
  {
    type: 'log_activity',
    requiredFeature: 'customers.activities.manage',
    payloadSchema: logActivityPayloadSchema,
    label: 'Log Activity',
    promptSchema: `log_activity payload:
{ contactId?: uuid, contactType: "person"|"company", contactName: string, activityType: "email"|"call"|"meeting"|"note", subject: string, body: string }`,
    execute: executeLogActivityAction,
  },
  {
    type: 'draft_reply',
    requiredFeature: 'inbox_ops.replies.send',
    payloadSchema: draftReplyPayloadSchema,
    label: 'Draft Reply',
    promptSchema: `draft_reply payload:
{ to: string (email), toName?: string, subject: string, body: string, context?: string }`,
    promptRules: ['For draft_reply: include ERP context when available.'],
    execute: executeDraftReplyAction,
  },
]

export default inboxActions
