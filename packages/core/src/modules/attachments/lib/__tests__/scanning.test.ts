/** @jest-environment node */
import type { AttachmentQuarantineStore } from '../quarantine'
import {
  AttachmentScanError,
  DefaultAttachmentScanGate,
  ensureAttachmentScanReceipt,
  resolveAttachmentScanPolicy,
  resolveAttachmentScanTimeoutMs,
  type AttachmentScanInput,
  type AttachmentScanResult,
  type AttachmentScanner,
} from '../scanning'

const EICAR = Buffer.from(
  'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*',
  'ascii',
)

function request(buffer = Buffer.from('clean')) {
  return {
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    fileName: 'sample.txt',
    mimeType: 'text/plain',
    source: 'test',
    buffer,
  }
}

function scanner(
  implementation: (input: AttachmentScanInput) => Promise<AttachmentScanResult>,
  id = 'test-scanner',
): AttachmentScanner {
  return { id, scan: implementation }
}

function quarantineStore(): AttachmentQuarantineStore & { quarantine: jest.Mock } {
  return {
    quarantine: jest.fn(async () => ({ quarantineId: 'quarantine-1' })),
  }
}

describe('DefaultAttachmentScanGate', () => {
  it('allows clean content and returns a bounded receipt', async () => {
    const quarantine = quarantineStore()
    const gate = new DefaultAttachmentScanGate(
      scanner(async () => ({ status: 'clean', reasonCode: 'no_threat' })),
      quarantine,
      'required',
      1_000,
    )

    const receipt = await gate.scan(request())

    expect(receipt).toEqual(expect.objectContaining({
      status: 'clean',
      scanner: 'test-scanner',
      policy: 'required',
      reasonCode: 'no_threat',
      contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    }))
    expect(quarantine.quarantine).not.toHaveBeenCalled()
  })

  it('rejects policy-blocked content without quarantine', async () => {
    const quarantine = quarantineStore()
    const gate = new DefaultAttachmentScanGate(
      scanner(async () => ({ status: 'rejected', reasonCode: 'file_policy' })),
      quarantine,
      'required',
      1_000,
    )

    await expect(gate.scan(request())).rejects.toMatchObject({
      code: 'rejected',
      receipt: { status: 'rejected' },
    })
    expect(quarantine.quarantine).not.toHaveBeenCalled()
  })

  it('quarantines an EICAR verdict before blocking it', async () => {
    const quarantine = quarantineStore()
    const gate = new DefaultAttachmentScanGate(
      scanner(async (input) => input.buffer.includes(Buffer.from('EICAR-STANDARD-ANTIVIRUS-TEST-FILE'))
        ? { status: 'quarantined', reasonCode: 'malware_detected' }
        : { status: 'clean' }),
      quarantine,
      'required',
      1_000,
    )

    await expect(gate.scan(request(EICAR))).rejects.toMatchObject({
      code: 'quarantined',
      quarantineId: 'quarantine-1',
      receipt: { status: 'quarantined' },
    })
    expect(quarantine.quarantine).toHaveBeenCalledWith(expect.objectContaining({
      buffer: EICAR,
      receipt: expect.objectContaining({ status: 'quarantined' }),
    }))
  })

  it('allows unavailable scans only under the optional policy', async () => {
    const quarantine = quarantineStore()
    const gate = new DefaultAttachmentScanGate(
      scanner(async () => ({ status: 'scanner_unavailable', reasonCode: 'upstream_down' })),
      quarantine,
      'optional',
      1_000,
    )

    await expect(gate.scan(request())).resolves.toMatchObject({
      status: 'scanner_unavailable',
      policy: 'optional',
      reasonCode: 'upstream_down',
    })
    expect(quarantine.quarantine).not.toHaveBeenCalled()
  })

  it('quarantines unavailable scans under the required policy', async () => {
    const quarantine = quarantineStore()
    const gate = new DefaultAttachmentScanGate(
      scanner(async () => { throw new Error('network details must not escape') }),
      quarantine,
      'required',
      1_000,
    )

    await expect(gate.scan(request())).rejects.toMatchObject({
      code: 'scanner_unavailable',
      receipt: {
        status: 'scanner_unavailable',
        reasonCode: 'scanner_error',
      },
    })
    expect(quarantine.quarantine).toHaveBeenCalledTimes(1)
  })

  it('normalizes timeouts and malformed scanner output to unavailable', async () => {
    const quarantine = quarantineStore()
    const timeoutGate = new DefaultAttachmentScanGate(
      scanner(async ({ signal }) => new Promise<AttachmentScanResult>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
      })),
      quarantine,
      'optional',
      5,
    )
    const malformedGate = new DefaultAttachmentScanGate(
      scanner(async () => ({ status: 'clean', reasonCode: 'ok', raw: 'secret' } as unknown as AttachmentScanResult)),
      quarantine,
      'optional',
      1_000,
    )

    await expect(timeoutGate.scan(request())).resolves.toMatchObject({ reasonCode: 'scanner_timeout' })
    await expect(malformedGate.scan(request())).resolves.toMatchObject({
      status: 'scanner_unavailable',
      reasonCode: 'invalid_scanner_response',
    })
  })

  it('does not invoke the scanner under the disabled policy', async () => {
    const scan = jest.fn(async () => ({ status: 'clean' as const }))
    const gate = new DefaultAttachmentScanGate(
      { id: 'should-not-run', scan },
      quarantineStore(),
      'disabled',
      1_000,
    )

    await expect(gate.scan(request())).resolves.toMatchObject({
      status: 'scanner_unavailable',
      scanner: 'disabled',
      reasonCode: 'scan_disabled',
    })
    expect(scan).not.toHaveBeenCalled()
  })

  it('blocks when quarantine persistence fails', async () => {
    const gate = new DefaultAttachmentScanGate(
      scanner(async () => ({ status: 'quarantined' })),
      { quarantine: jest.fn(async () => { throw new Error('disk full') }) },
      'required',
      1_000,
    )

    await expect(gate.scan(request())).rejects.toBeInstanceOf(AttachmentScanError)
    await expect(gate.scan(request())).rejects.toMatchObject({ code: 'quarantine_failed' })
  })

  it('reuses only an in-process receipt for the exact same scan context', async () => {
    const scan = jest.fn(async () => ({ status: 'clean' as const }))
    const gate = new DefaultAttachmentScanGate({ id: 'test', scan }, quarantineStore(), 'required', 1_000)
    const scanRequest = request()
    const receipt = await gate.scan(scanRequest)

    await expect(ensureAttachmentScanReceipt({ gate, request: scanRequest, receipt })).resolves.toBe(receipt)
    await ensureAttachmentScanReceipt({
      gate,
      request: { ...scanRequest, organizationId: 'org-2' },
      receipt,
    })
    expect(scan).toHaveBeenCalledTimes(2)
  })
})

describe('attachment scanning configuration', () => {
  it('defaults invalid policies to optional', () => {
    expect(resolveAttachmentScanPolicy({})).toBe('optional')
    expect(resolveAttachmentScanPolicy({ OM_ATTACHMENT_SCAN_POLICY: 'invalid' })).toBe('optional')
    expect(resolveAttachmentScanPolicy({ OM_ATTACHMENT_SCAN_POLICY: ' REQUIRED ' })).toBe('required')
  })

  it('bounds scanner timeouts', () => {
    expect(resolveAttachmentScanTimeoutMs({})).toBe(15_000)
    expect(resolveAttachmentScanTimeoutMs({ OM_ATTACHMENT_SCAN_TIMEOUT_MS: '1' })).toBe(1_000)
    expect(resolveAttachmentScanTimeoutMs({ OM_ATTACHMENT_SCAN_TIMEOUT_MS: '999999' })).toBe(120_000)
  })
})
