import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { BackupAuditReceipt } from './contracts'

type UnsignedAuditReceipt = Omit<BackupAuditReceipt, 'signature'>

function keyFingerprint(key: Buffer): string {
  return createHash('sha256').update(key).digest('hex').slice(0, 16)
}

function signReceipt(receipt: UnsignedAuditReceipt, key: Buffer): string {
  return createHmac('sha256', key).update(JSON.stringify(receipt)).digest('base64')
}

export async function writeAuditReceipt(input: {
  auditDirectory: string
  hmacKey: Buffer
  receipt: Omit<UnsignedAuditReceipt, 'receiptVersion' | 'receiptId'>
  randomId?: () => string
}): Promise<string> {
  const unsigned: UnsignedAuditReceipt = {
    receiptVersion: 1,
    receiptId: (input.randomId ?? randomUUID)(),
    ...input.receipt,
  }
  const receipt: BackupAuditReceipt = {
    ...unsigned,
    signature: {
      algorithm: 'hmac-sha256',
      keyFingerprint: keyFingerprint(input.hmacKey),
      valueBase64: signReceipt(unsigned, input.hmacKey),
    },
  }
  await mkdir(input.auditDirectory, { recursive: true, mode: 0o700 })
  const fileName = [
    receipt.operationId,
    receipt.operationType,
    receipt.phase,
    receipt.receiptId,
  ].join('.') + '.json'
  const filePath = path.join(input.auditDirectory, fileName)
  await writeFile(filePath, `${JSON.stringify(receipt, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  })
  return filePath
}

export async function readAuditReceipt(filePath: string): Promise<BackupAuditReceipt> {
  const parsed: unknown = JSON.parse(await readFile(filePath, 'utf8'))
  if (!isAuditReceipt(parsed)) {
    throw new Error('Invalid backup audit receipt.')
  }
  return parsed
}

export function verifyAuditReceipt(receipt: BackupAuditReceipt, hmacKey: Buffer): boolean {
  if (receipt.signature.keyFingerprint !== keyFingerprint(hmacKey)) return false
  const { signature, ...unsigned } = receipt
  const actual = Buffer.from(signature.valueBase64, 'base64')
  const expected = Buffer.from(signReceipt(unsigned, hmacKey), 'base64')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

function isAuditReceipt(value: unknown): value is BackupAuditReceipt {
  if (!value || typeof value !== 'object') return false
  const receipt = value as Record<string, unknown>
  const signature = receipt.signature
  return receipt.receiptVersion === 1
    && typeof receipt.receiptId === 'string'
    && typeof receipt.operationId === 'string'
    && (receipt.backupOperationId === null || typeof receipt.backupOperationId === 'string')
    && (receipt.operationType === 'backup' || receipt.operationType === 'verify' || receipt.operationType === 'restore')
    && (receipt.phase === 'started' || receipt.phase === 'completed' || receipt.phase === 'failed')
    && typeof receipt.actor === 'string'
    && receipt.scope === 'instance'
    && typeof receipt.occurredAt === 'string'
    && typeof receipt.dryRun === 'boolean'
    && (receipt.result === 'started' || receipt.result === 'completed' || receipt.result === 'failed')
    && !!signature
    && typeof signature === 'object'
    && (signature as Record<string, unknown>).algorithm === 'hmac-sha256'
    && typeof (signature as Record<string, unknown>).keyFingerprint === 'string'
    && typeof (signature as Record<string, unknown>).valueBase64 === 'string'
}
