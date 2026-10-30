/**
 * PDF/export neutrality — R-CS-5 / D9 of `.ai/specs/2026-05-22-forms-custom-styling.md`.
 *
 * The signed-PDF audit snapshot MUST be theme-free: custom styling
 * (`x-om-theme`, `OmSection.style`, `x-om-style`) affects only the interactive
 * runtime + studio preview and may NEVER leak into the legally-retained
 * artifact. These tests lock that contract in two complementary ways:
 *
 *   1. The pure `buildSnapshotDocument(...)` model produced from a fully themed
 *      schema is DEEP-EQUAL to the model produced from the same schema with
 *      every styling keyword stripped — so no style data can reach the document
 *      contract (labels, answers, sections, audit, signature evidence).
 *   2. `renderDocumentToPdf(...)` of those two equal models yields byte-identical
 *      PDFs once pdf-lib's non-deterministic metadata (CreationDate / ModDate /
 *      trailer ID) is normalized — so no theme-derived bytes reach the PDF.
 *
 * A source-level guard additionally asserts the service never references the
 * style keyword constants at all.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  buildSnapshotDocument,
  renderDocumentToPdf,
  type BuildSnapshotDocumentArgs,
} from '../services/pdf-snapshot-service'
import type { Form, FormSubmission, FormVersion } from '../data/entities'
import type { OmTheme, OmSectionStyle, OmFieldStyle } from '../schema/style-extensions'

const ORG_ID = '11111111-1111-1111-1111-111111111111'
const TENANT_ID = '22222222-2222-2222-2222-222222222222'
const SUBMISSION_ID = '33333333-3333-3333-3333-333333333333'
const VERSION_ID = '44444444-4444-4444-4444-444444444444'
const SUBMITTED_BY = '55555555-5555-5555-5555-555555555555'
const CLAUSE_SHA = 'a'.repeat(64)

const THEME: OmTheme = {
  background: { kind: 'gradient', from: '#0f766e', to: '#115e59', angle: 135 },
  surface: '#ffffff',
  foreground: '#0f172a',
  accent: '#0f766e',
  border: '#cbd5e1',
  fontFamily: 'rounded',
  fontScale: 'lg',
  radius: 'lg',
  contentWidth: 'sm',
}

const SECTION_STYLE: OmSectionStyle = {
  background: { kind: 'color', color: 'surface-muted' },
  foreground: '#0f172a',
  padding: 'lg',
  border: 'strong',
  radius: 'lg',
  card: true,
  align: 'center',
}

const FIELD_STYLE: OmFieldStyle = {
  labelWeight: 'bold',
  labelColor: '#0f766e',
  textColor: '#0f172a',
  accent: '#0f766e',
  align: 'center',
}

/** Builds a version whose schema carries styling at root, section, and field level. */
function buildThemedVersion(): FormVersion {
  return {
    id: VERSION_ID,
    formId: 'form-1',
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    versionNumber: 7,
    status: 'published',
    schemaHash: 'sha256:deadbeef',
    registryVersion: 'v1:abc',
    schema: {
      type: 'object',
      'x-om-roles': ['patient'],
      'x-om-theme': THEME,
      'x-om-sections': [
        {
          key: 'health',
          title: { en: 'Health History' },
          fieldKeys: ['allergies', 'smoker', 'visit_date'],
          style: SECTION_STYLE,
        },
        {
          key: 'consent',
          title: { en: 'Consent' },
          fieldKeys: ['agree', 'sig'],
          style: SECTION_STYLE,
        },
      ],
      properties: {
        allergies: {
          type: 'string',
          'x-om-type': 'text',
          'x-om-label': { en: 'Known allergies' },
          'x-om-style': FIELD_STYLE,
        },
        smoker: {
          type: 'boolean',
          'x-om-type': 'boolean',
          'x-om-label': { en: 'Do you smoke?' },
          'x-om-style': FIELD_STYLE,
        },
        visit_date: {
          type: 'string',
          'x-om-type': 'date',
          'x-om-label': { en: 'Last visit' },
          'x-om-style': FIELD_STYLE,
        },
        agree: {
          type: 'boolean',
          'x-om-type': 'boolean',
          'x-om-label': { en: 'I agree' },
          'x-om-style': FIELD_STYLE,
        },
        sig: {
          type: 'object',
          'x-om-type': 'signature',
          'x-om-label': { en: 'Signature' },
          'x-om-consent-clause': { en: 'I consent to the proposed treatment.' },
          'x-om-style': FIELD_STYLE,
        },
      },
    },
    uiSchema: {},
    roles: ['patient'],
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as FormVersion
}

/** Recursively removes every styling keyword from a schema-like value. */
function stripStyling(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripStyling)
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (key === 'x-om-theme' || key === 'x-om-style' || key === 'style') continue
      result[key] = stripStyling(child)
    }
    return result
  }
  return value
}

function buildPlainVersion(): FormVersion {
  const themed = buildThemedVersion()
  return {
    ...themed,
    schema: stripStyling((themed as unknown as { schema: unknown }).schema),
  } as unknown as FormVersion
}

function buildForm(): Form {
  return {
    id: 'form-1',
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    key: 'consent',
    name: 'Patient Consent Form',
    defaultLocale: 'en',
    supportedLocales: ['en'],
    createdBy: SUBMITTED_BY,
    status: 'active',
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as Form
}

function buildSubmission(): FormSubmission {
  return {
    id: SUBMISSION_ID,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    formVersionId: VERSION_ID,
    subjectType: 'forms_invitation',
    subjectId: '66666666-6666-6666-6666-666666666666',
    status: 'submitted',
    startedBy: SUBMITTED_BY,
    submittedBy: SUBMITTED_BY,
    submittedAt: new Date('2026-05-21T10:30:00.000Z'),
    submitMetadata: {
      ip: '203.0.113.7',
      userAgent: 'Mozilla/5.0 (TestRunner)',
      serverSubmittedAt: '2026-05-21T10:30:00.000Z',
    },
    firstSavedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as FormSubmission
}

const ANSWERS = {
  allergies: 'Penicillin',
  smoker: false,
  visit_date: '2026-01-15',
  agree: true,
  sig: {
    mode: 'typed',
    typedName: 'Jane Patient',
    affirmed: true,
    signedAt: '2026-05-21T10:29:50.000Z',
    clauseSha256: CLAUSE_SHA,
  },
}

function argsFor(version: FormVersion): BuildSnapshotDocumentArgs {
  return {
    form: buildForm(),
    formVersion: version,
    submission: buildSubmission(),
    answers: ANSWERS,
  }
}

/**
 * pdf-lib injects an Info dictionary (CreationDate / ModDate) and a trailer ID
 * derived from the current time, so two renders of the same model differ only
 * in those bytes. Normalizing them lets us assert that the *content* bytes are
 * identical — proving zero theme leakage into the artifact.
 */
function normalizePdf(bytes: Buffer): string {
  return bytes
    .toString('latin1')
    .replace(/\/CreationDate\s*\([^)]*\)/g, '/CreationDate(X)')
    .replace(/\/ModDate\s*\([^)]*\)/g, '/ModDate(X)')
    .replace(/\/ID\s*\[\s*<[0-9a-fA-F]*>\s*<[0-9a-fA-F]*>\s*\]/g, '/ID[<X><X>]')
}

describe('PDF/export neutrality (R-CS-5 / D9)', () => {
  it('produces an identical document model whether the schema is themed or stripped', () => {
    const themed = buildSnapshotDocument(argsFor(buildThemedVersion()))
    const plain = buildSnapshotDocument(argsFor(buildPlainVersion()))
    // Deep equality across formName, version, locale, sections (keys, labels,
    // answers, signature evidence) and the audit block — styling cannot reach
    // any field of the legally-retained snapshot model.
    expect(themed).toEqual(plain)
  })

  it('renders byte-identical PDF content for themed vs stripped schema (modulo pdf-lib timestamps)', async () => {
    // pdf-lib stamps CreationDate/ModDate via `new Date()` and writes them into
    // a flate-compressed object stream, so normalizePdf's regex cannot reach
    // them. If the two renders straddle a clock tick the compressed bytes
    // differ and the comparison flakes. Freeze the clock (timers/microtasks
    // stay real so pdf-lib's async font embedding still resolves) so both
    // renders capture an identical timestamp — real theme leakage would still
    // surface as a content-byte difference.
    jest.useFakeTimers({
      now: new Date('2026-05-21T10:30:00.000Z'),
      doNotFake: [
        'setTimeout',
        'clearTimeout',
        'setInterval',
        'clearInterval',
        'setImmediate',
        'clearImmediate',
        'nextTick',
        'queueMicrotask',
        'requestAnimationFrame',
        'cancelAnimationFrame',
        'requestIdleCallback',
        'cancelIdleCallback',
        'hrtime',
        'performance',
      ],
    })
    try {
      const themedDoc = buildSnapshotDocument(argsFor(buildThemedVersion()))
      const plainDoc = buildSnapshotDocument(argsFor(buildPlainVersion()))
      const themedPdf = await renderDocumentToPdf(themedDoc)
      const plainPdf = await renderDocumentToPdf(plainDoc)
      expect(normalizePdf(themedPdf)).toEqual(normalizePdf(plainPdf))
    } finally {
      jest.useRealTimers()
    }
  })

  it('the snapshot service source never references the styling keyword constants', () => {
    const source = readFileSync(
      join(__dirname, '..', 'services', 'pdf-snapshot-service.ts'),
      'utf8',
    )
    expect(source).not.toContain('x-om-theme')
    expect(source).not.toContain('x-om-style')
    expect(source).not.toContain('style-compiler')
    expect(source).not.toContain('resolveFormTheme')
    expect(source).not.toContain('resolveSectionStyle')
    expect(source).not.toContain('resolveFieldStyle')
  })
})
