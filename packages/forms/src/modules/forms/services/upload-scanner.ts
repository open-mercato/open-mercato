/**
 * Pluggable virus / malware scan hook — W4 (SEC-4).
 *
 * The default implementation is a NO-OP that reports every payload as clean.
 * Operators inject a real scanner (ClamAV, a cloud AV API, …) by registering
 * an `UploadScanner` under the DI key `formsUploadScanner` — see `di.ts`. When
 * a scanner reports `{ clean: false }`, the upload service rejects the upload
 * (HTTP 422) and never persists the bytes.
 */

export type UploadScanInput = {
  bytes: Buffer
  contentType: string
  filename: string
}

export type UploadScanResult = {
  clean: boolean
  /** Optional human-readable reason surfaced when `clean === false`. */
  reason?: string
}

export interface UploadScanner {
  scan(input: UploadScanInput): Promise<UploadScanResult>
}

/**
 * Default no-op scanner. SAFE-BY-DECLARATION ONLY — it performs no inspection
 * and always returns `{ clean: true }`. Operators MUST replace it with a real
 * scanner before accepting untrusted uploads in production.
 */
export class NoopUploadScanner implements UploadScanner {
  async scan(): Promise<UploadScanResult> {
    return { clean: true }
  }
}
