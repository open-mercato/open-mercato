import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ts from 'typescript-js';
import type {
  CapturedTestSeedAttachmentDigest,
  CapturedTestSeedEmail,
} from '../communicationChannelsFixtures';

const FIXTURES_MODULE = path.resolve(__dirname, '../communicationChannelsFixtures');

function typeErrorsOf(source: string): string[] {
  const directory = mkdtempSync(path.join(tmpdir(), 'om-capture-contract-'));
  const file = path.join(directory, 'consumer.ts');
  try {
    writeFileSync(file, source, 'utf8');
    const program = ts.createProgram([file], {
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      target: ts.ScriptTarget.ES2022,
      types: [],
    });
    return ts
      .getPreEmitDiagnostics(program)
      .filter((diagnostic) => diagnostic.file?.fileName === file)
      .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe('CapturedTestSeedEmail', () => {
  it('still compiles a consumer written against the original attachment shape', () => {
    const errors = typeErrorsOf(`
import type { CapturedTestSeedEmail } from ${JSON.stringify(FIXTURES_MODULE)};

const legacy: CapturedTestSeedEmail = {
  capturedAt: '2026-10-01T00:00:00.000Z',
  externalMessageId: 'legacy@test-seed.local',
  content: { attachments: [{ url: 'https://files.example.test/a.pdf', mimeType: 'application/pdf', fileName: 'a.pdf' }] },
  credentials: {},
  scope: { tenantId: 'tenant-1', organizationId: 'organization-1' },
};
const url: string = legacy.content.attachments![0].url;
const inline: boolean | undefined = legacy.content.attachments![0].inline;
export { url, inline };
`);

    expect(errors).toEqual([]);
  }, 30_000);

  it('carries versioned attachment digests next to the original attachments', () => {
    const digest: CapturedTestSeedAttachmentDigest = {
      version: 1,
      fileName: 'a.pdf',
      mimeType: 'application/pdf',
      fileSize: 3,
      sha256: 'f'.repeat(64),
    };
    const captured: CapturedTestSeedEmail = {
      capturedAt: '2026-10-01T00:00:00.000Z',
      externalMessageId: 'digest@test-seed.local',
      content: { text: 'hi', attachmentDigests: [digest] },
      credentials: {},
      scope: { tenantId: 'tenant-1', organizationId: 'organization-1' },
    };

    expect(captured.content.attachments).toBeUndefined();
    expect(captured.content.attachmentDigests).toEqual([digest]);
  });
});
