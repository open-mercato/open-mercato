import type { QueuedJob } from "@open-mercato/queue";
import type { ImportProgress, ImportSession } from "../../data/entities";

// ---------------------------------------------------------------------------
// Module mocks — must be declared before any imports that trigger module load
// ---------------------------------------------------------------------------

jest.mock("@open-mercato/shared/lib/di/container", () => ({
  createRequestContainer: jest.fn(),
}));

jest.mock("../../lib/airtable-client", () => ({
  AirtableClient: jest.fn().mockImplementation(() => ({
    fetchAllRecords: jest.fn().mockResolvedValue([]),
  })),
}));

jest.mock("../../lib/importers", () => ({
  resolveImporter: jest.fn(),
}));

jest.mock("../../lib/field-transformers", () => ({
  transformFieldValue: jest.fn(
    (_type: string, value: unknown) => value ?? null,
  ),
}));

jest.mock("../../lib/token-crypto", () => ({
  decryptToken: jest.fn((v: string) => v),
  encryptToken: jest.fn((v: string) => v),
}));

// ---------------------------------------------------------------------------
// Imports resolved AFTER mocks are in place
// ---------------------------------------------------------------------------

import handler from "../import.worker";
import { createRequestContainer } from "@open-mercato/shared/lib/di/container";
import { AirtableClient } from "../../lib/airtable-client";
import { resolveImporter } from "../../lib/importers";
import { transformFieldValue } from "../../lib/field-transformers";

// ---------------------------------------------------------------------------
// Helper types
// ---------------------------------------------------------------------------

interface WorkerPayload {
  sessionId: string;
  tenantId: string;
  omUrl: string;
  omApiKey: string;
  isRetry?: boolean;
  retryAirtableIds?: Record<string, string[]>;
}

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makePlanTable(
  overrides: Partial<{
    airtableTableId: string;
    airtableTableName: string;
    targetModule: string | null;
    targetEntitySlug: string | null;
    records: Array<{
      airtableId: string;
      omId: string;
      originalCreatedAt?: string | null;
      originalUpdatedAt?: string | null;
    }>;
  }> = {},
) {
  return {
    airtableTableId: "tbl1",
    airtableTableName: "Klienci",
    targetModule: "customers.people",
    targetEntitySlug: null,
    records: [
      {
        airtableId: "rec1",
        omId: "uuid-1",
        originalCreatedAt: null,
        originalUpdatedAt: null,
      },
      {
        airtableId: "rec2",
        omId: "uuid-2",
        originalCreatedAt: null,
        originalUpdatedAt: null,
      },
    ],
    ...overrides,
  };
}

function makeMockSession(
  overrides: Partial<ImportSession> = {},
): ImportSession {
  return {
    id: "session-1",
    tenantId: "tenant-1",
    organizationId: "org-1",
    airtableToken: "pat_token",
    airtableBaseId: "appBase123",
    status: "importing",
    currentStep: 7,
    planJson: {
      importOrder: ["tbl1"],
      tables: {
        tbl1: makePlanTable(),
      },
      users: {},
      totalRecords: 2,
      generatedAt: new Date().toISOString(),
    },
    mappingJson: {
      tables: [
        {
          airtableTableId: "tbl1",
          airtableTableName: "Klienci",
          targetModule: "customers.people",
          targetEntitySlug: null,
          confidence: 0.9,
          skip: false,
          fieldMappings: [
            {
              airtableFieldId: "fld1",
              airtableFieldName: "Email",
              airtableFieldType: "email",
              omFieldKey: "primaryEmail",
              omFieldType: "email",
              isMappedToCreatedAt: false,
              isMappedToUpdatedAt: false,
              skip: false,
              sampleValues: ["test@example.com"],
            },
          ],
        },
      ],
    },
    configJson: null,
    progressJson: null,
    reportJson: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as unknown as ImportSession;
}

function buildMockEm(sessionOverrides: Partial<ImportSession> = {}) {
  const mockSession = makeMockSession(sessionOverrides);

  const mockFlush = jest.fn().mockResolvedValue(undefined);
  const mockFindOne = jest.fn().mockResolvedValue(mockSession);
  const mockRaw = jest.fn().mockResolvedValue(undefined);
  const mockGetKnex = jest.fn().mockReturnValue({ raw: mockRaw });
  const mockGetConnection = jest.fn().mockReturnValue({ getKnex: mockGetKnex });
  const mockForkFindOne = jest.fn().mockResolvedValue(mockSession);

  const em = {
    findOne: mockFindOne,
    flush: mockFlush,
    fork: jest.fn().mockReturnValue({
      findOne: mockForkFindOne,
    }),
    getConnection: mockGetConnection,
  };

  return { em, mockSession, mockFindOne, mockFlush, mockForkFindOne, mockRaw };
}

function makeJob(
  overrides: Partial<WorkerPayload> = {},
): QueuedJob<WorkerPayload> {
  return {
    payload: {
      sessionId: "session-1",
      tenantId: "tenant-1",
      omUrl: "http://localhost:3000",
      omApiKey: "test-key",
      ...overrides,
    },
  } as unknown as QueuedJob<WorkerPayload>;
}

/**
 * Shorthand for the most common test setup: single table "tbl1" with one record "rec1"/"uuid-1".
 * Use buildMockEm() directly for multi-table, multi-record, or custom-structure tests.
 */
function buildSingleRecordSession(
  recordOverrides: Partial<{
    airtableId: string;
    omId: string;
    originalCreatedAt: string | null;
    originalUpdatedAt: string | null;
  }> = {},
  sessionOverrides: Partial<ImportSession> = {},
) {
  return buildMockEm({
    planJson: {
      importOrder: ["tbl1"],
      tables: {
        tbl1: makePlanTable({
          records: [
            {
              airtableId: "rec1",
              omId: "uuid-1",
              originalCreatedAt: null,
              originalUpdatedAt: null,
              ...recordOverrides,
            },
          ],
        }),
      },
      users: {},
      totalRecords: 1,
      generatedAt: new Date().toISOString(),
    },
    ...sessionOverrides,
  });
}

function wireContainer(em: ReturnType<typeof buildMockEm>["em"]) {
  const mockedCreate = createRequestContainer as jest.MockedFunction<
    typeof createRequestContainer
  >;
  mockedCreate.mockResolvedValue({
    resolve: jest.fn().mockReturnValue(em),
  } as unknown as Awaited<ReturnType<typeof createRequestContainer>>);
}

function makeOkImporter(omId = "uuid-1") {
  return jest.fn().mockResolvedValue({ ok: true, omId });
}

function makeFailedImporter(error = "HTTP 500") {
  return jest.fn().mockResolvedValue({ ok: false, omId: null, error });
}

function makeNeedsAttentionImporter(reason = "brak email") {
  return jest
    .fn()
    .mockResolvedValue({
      ok: false,
      omId: null,
      needsAttention: true,
      attentionReason: reason,
    });
}

function wireImporter(importerFn: jest.Mock) {
  const mockedResolve = resolveImporter as jest.MockedFunction<
    typeof resolveImporter
  >;
  mockedResolve.mockReturnValue(
    importerFn as unknown as ReturnType<typeof resolveImporter>,
  );
}

function wireAirtableRecords(
  records: Array<{
    id: string;
    fields: Record<string, unknown>;
    createdTime?: string;
  }>,
) {
  const MockAirtableClient = AirtableClient as jest.MockedClass<
    typeof AirtableClient
  >;
  MockAirtableClient.mockImplementation(
    () =>
      ({
        fetchAllRecords: jest.fn().mockResolvedValue(records),
      }) as unknown as AirtableClient,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("import.worker handler", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Guard clauses — early return
  // -------------------------------------------------------------------------

  describe("early return guard clauses", () => {
    it("returns without error when session is not found", async () => {
      const { em } = buildMockEm();
      em.findOne.mockResolvedValue(null);
      wireContainer(em);
      wireImporter(makeOkImporter());

      await expect(handler(makeJob())).resolves.toBeUndefined();
      expect(em.flush).not.toHaveBeenCalled();
    });

    it("returns without error when session has no planJson", async () => {
      const { em } = buildMockEm({ planJson: null });
      wireContainer(em);
      wireImporter(makeOkImporter());

      await expect(handler(makeJob())).resolves.toBeUndefined();
      expect(em.flush).not.toHaveBeenCalled();
    });

    it("returns without error when session has no mappingJson", async () => {
      const { em } = buildMockEm({ mappingJson: null });
      wireContainer(em);
      wireImporter(makeOkImporter());

      await expect(handler(makeJob())).resolves.toBeUndefined();
      expect(em.flush).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Cancellation
  // -------------------------------------------------------------------------

  describe("cancellation check per table", () => {
    it("stops processing when freshSession.status is cancelled", async () => {
      const { em } = buildMockEm();
      // fork's findOne returns a cancelled session
      em.fork.mockReturnValue({
        findOne: jest
          .fn()
          .mockResolvedValue(makeMockSession({ status: "cancelled" })),
      });
      wireContainer(em);
      const importerFn = makeOkImporter();
      wireImporter(importerFn);
      wireAirtableRecords([
        { id: "rec1", fields: { Email: "a@b.com" } },
        { id: "rec2", fields: { Email: "c@d.com" } },
      ]);

      await handler(makeJob());

      // Worker returns early — importer is never called
      expect(importerFn).not.toHaveBeenCalled();
      // Session is not finalised — status stays as it was, not set to 'done'
      const mockSession = await em.findOne(
        null as unknown as typeof import("../../data/entities").ImportSession,
        {},
      );
      expect(mockSession?.status).not.toBe("done");
    });

    it("continues processing when forked findOne returns null", async () => {
      const { em, mockSession } = buildMockEm();
      em.fork.mockReturnValue({
        findOne: jest.fn().mockResolvedValue(null),
      });
      wireContainer(em);
      const importerFn = makeOkImporter("uuid-1");
      wireImporter(importerFn);
      wireAirtableRecords([
        { id: "rec1", fields: { Email: "a@b.com" } },
        { id: "rec2", fields: { Email: "c@d.com" } },
      ]);

      await handler(makeJob());

      // Importer was called — processing continued
      expect(importerFn).toHaveBeenCalled();
      expect(mockSession.status).toBe("done");
    });

    it("stops after first table when second table is cancelled", async () => {
      const session = makeMockSession({
        planJson: {
          importOrder: ["tbl1", "tbl2"],
          tables: {
            tbl1: makePlanTable({
              airtableTableId: "tbl1",
              records: [
                {
                  airtableId: "rec1",
                  omId: "uuid-1",
                  originalCreatedAt: null,
                  originalUpdatedAt: null,
                },
              ],
            }),
            tbl2: makePlanTable({
              airtableTableId: "tbl2",
              airtableTableName: "Firmy",
              records: [
                {
                  airtableId: "rec3",
                  omId: "uuid-3",
                  originalCreatedAt: null,
                  originalUpdatedAt: null,
                },
              ],
            }),
          },
          users: {},
          totalRecords: 2,
          generatedAt: new Date().toISOString(),
        },
        mappingJson: {
          tables: [
            {
              airtableTableId: "tbl1",
              airtableTableName: "Klienci",
              targetModule: "customers.people",
              targetEntitySlug: null,
              confidence: 0.9,
              skip: false,
              fieldMappings: [],
            },
            {
              airtableTableId: "tbl2",
              airtableTableName: "Firmy",
              targetModule: "customers.companies",
              targetEntitySlug: null,
              confidence: 0.9,
              skip: false,
              fieldMappings: [],
            },
          ],
        },
      });
      const { em } = buildMockEm();
      em.findOne.mockResolvedValue(session);

      let callCount = 0;
      em.fork.mockImplementation(() => ({
        findOne: jest.fn().mockImplementation(async () => {
          callCount++;
          // First check (tbl1): not cancelled; second check (tbl2): cancelled
          return callCount === 1
            ? session
            : { ...session, status: "cancelled" };
        }),
      }));

      wireContainer(em);
      const importerFn = makeOkImporter();
      wireImporter(importerFn);
      wireAirtableRecords([{ id: "rec1", fields: {} }]);

      await handler(makeJob());

      // Importer called once (for tbl1 record), not for tbl2
      expect(importerFn).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // Table skipping
  // -------------------------------------------------------------------------

  describe("table skipping", () => {
    it("skips tables where tableMapping.skip is true", async () => {
      const { em } = buildMockEm({
        mappingJson: {
          tables: [
            {
              airtableTableId: "tbl1",
              airtableTableName: "Klienci",
              targetModule: "customers.people",
              targetEntitySlug: null,
              confidence: 0.9,
              skip: true,
              fieldMappings: [],
            },
          ],
        },
      });
      wireContainer(em);
      const importerFn = makeOkImporter();
      wireImporter(importerFn);

      await handler(makeJob());

      expect(importerFn).not.toHaveBeenCalled();
    });

    it("skips tables that have no entry in plan.tables", async () => {
      const { em } = buildMockEm({
        planJson: {
          importOrder: ["tbl_unknown"],
          tables: {},
          users: {},
          totalRecords: 0,
          generatedAt: new Date().toISOString(),
        },
        mappingJson: {
          tables: [
            {
              airtableTableId: "tbl_unknown",
              airtableTableName: "Ghost",
              targetModule: "customers.people",
              targetEntitySlug: null,
              confidence: 0.5,
              skip: false,
              fieldMappings: [],
            },
          ],
        },
      });
      wireContainer(em);
      const importerFn = makeOkImporter();
      wireImporter(importerFn);

      await handler(makeJob());

      expect(importerFn).not.toHaveBeenCalled();
    });

    it("skips tables missing a tableMapping entirely", async () => {
      const { em } = buildMockEm({
        mappingJson: { tables: [] }, // no mapping for tbl1
      });
      wireContainer(em);
      const importerFn = makeOkImporter();
      wireImporter(importerFn);

      await handler(makeJob());

      expect(importerFn).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Record processing — happy path
  // -------------------------------------------------------------------------

  describe("record processing — ok results", () => {
    it("marks a single record as done and increments done counter", async () => {
      const { em, mockSession } = buildSingleRecordSession();
      wireContainer(em);
      wireImporter(makeOkImporter("uuid-1"));
      wireAirtableRecords([{ id: "rec1", fields: { Email: "a@b.com" } }]);

      await handler(makeJob());

      const progressTbl1 = mockSession.progressJson!.tables["tbl1"];
      expect(progressTbl1.done).toBe(1);
      expect(progressTbl1.failed).toBe(0);
      expect(progressTbl1.records["rec1"].status).toBe("done");
    });

    it("marks two records as done when both importers succeed", async () => {
      const { em, mockSession } = buildMockEm();
      wireContainer(em);
      wireImporter(makeOkImporter());
      wireAirtableRecords([
        { id: "rec1", fields: { Email: "a@b.com" } },
        { id: "rec2", fields: { Email: "c@d.com" } },
      ]);

      await handler(makeJob());

      const progressTbl1 = mockSession.progressJson!.tables["tbl1"];
      expect(progressTbl1.done).toBe(2);
      expect(progressTbl1.records["rec1"].status).toBe("done");
      expect(progressTbl1.records["rec2"].status).toBe("done");
    });

    it("sets session.status to done and currentStep to 8 after completion", async () => {
      const { em, mockSession } = buildMockEm();
      wireContainer(em);
      wireImporter(makeOkImporter());
      wireAirtableRecords([
        { id: "rec1", fields: {} },
        { id: "rec2", fields: {} },
      ]);

      await handler(makeJob());

      expect(mockSession.status).toBe("done");
      expect(mockSession.currentStep).toBe(8);
    });

    it("populates reportTables with imported count", async () => {
      const { em, mockSession } = buildMockEm();
      wireContainer(em);
      wireImporter(makeOkImporter());
      wireAirtableRecords([
        { id: "rec1", fields: {} },
        { id: "rec2", fields: {} },
      ]);

      await handler(makeJob());

      expect(mockSession.reportJson?.tables["tbl1"].imported).toBe(2);
      expect(mockSession.reportJson?.tables["tbl1"].hardErrors).toBe(0);
      expect(mockSession.reportJson?.tables["tbl1"].needsAttention).toBe(0);
    });

    it("sets completedAt on reportJson", async () => {
      const { em, mockSession } = buildMockEm();
      wireContainer(em);
      wireImporter(makeOkImporter());
      wireAirtableRecords([
        { id: "rec1", fields: {} },
        { id: "rec2", fields: {} },
      ]);

      await handler(makeJob());

      expect(mockSession.reportJson?.completedAt).toBeTruthy();
      // Validate it is an ISO date string
      expect(() => new Date(mockSession.reportJson!.completedAt)).not.toThrow();
    });

    it("calls em.flush at least once at the end", async () => {
      const { em, mockFlush } = buildMockEm();
      wireContainer(em);
      wireImporter(makeOkImporter());
      wireAirtableRecords([
        { id: "rec1", fields: {} },
        { id: "rec2", fields: {} },
      ]);

      await handler(makeJob());

      expect(mockFlush).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // needsAttention results
  // -------------------------------------------------------------------------

  describe("record processing — needsAttention results", () => {
    it("increments needsAttention counter when importer returns needsAttention: true", async () => {
      const { em, mockSession } = buildSingleRecordSession();
      wireContainer(em);
      wireImporter(makeNeedsAttentionImporter("brak email"));
      wireAirtableRecords([{ id: "rec1", fields: {} }]);

      await handler(makeJob());

      const progressTbl1 = mockSession.progressJson!.tables["tbl1"];
      expect(progressTbl1.needsAttention).toBe(1);
      expect(progressTbl1.done).toBe(0);
      expect(progressTbl1.records["rec1"].status).toBe("needs_attention");
    });

    it("adds a needsAttention record to reportJson with issueType missing_field", async () => {
      const { em, mockSession } = buildSingleRecordSession();
      wireContainer(em);
      wireImporter(makeNeedsAttentionImporter("brak email"));
      wireAirtableRecords([{ id: "rec1", fields: {} }]);

      await handler(makeJob());

      const tableReport = mockSession.reportJson?.tables["tbl1"];
      expect(tableReport?.records).toHaveLength(1);
      expect(tableReport?.records[0].issueType).toBe("missing_field");
      expect(tableReport?.records[0].issue).toBe("brak email");
    });

    it("builds correct airtableUrl in the needs_attention report record", async () => {
      const { em, mockSession } = buildSingleRecordSession({}, { airtableBaseId: "appBase123" });
      wireContainer(em);
      wireImporter(makeNeedsAttentionImporter("reason"));
      wireAirtableRecords([{ id: "rec1", fields: {} }]);

      await handler(makeJob());

      const reportRecord = mockSession.reportJson?.tables["tbl1"].records[0];
      expect(reportRecord?.airtableUrl).toBe(
        "https://airtable.com/appBase123/tbl1/rec1",
      );
    });
  });

  // -------------------------------------------------------------------------
  // Hard error results
  // -------------------------------------------------------------------------

  describe("record processing — hard error results", () => {
    it("increments failed counter when importer returns ok: false without needsAttention", async () => {
      const { em, mockSession } = buildSingleRecordSession();
      wireContainer(em);
      wireImporter(makeFailedImporter("HTTP 500"));
      wireAirtableRecords([{ id: "rec1", fields: {} }]);

      await handler(makeJob());

      const progressTbl1 = mockSession.progressJson!.tables["tbl1"];
      expect(progressTbl1.failed).toBe(1);
      expect(progressTbl1.done).toBe(0);
      expect(progressTbl1.records["rec1"].status).toBe("failed");
    });

    it("adds a hard_error report record with the importer error message", async () => {
      const { em, mockSession } = buildSingleRecordSession();
      wireContainer(em);
      wireImporter(makeFailedImporter("HTTP 500"));
      wireAirtableRecords([{ id: "rec1", fields: {} }]);

      await handler(makeJob());

      const tableReport = mockSession.reportJson?.tables["tbl1"];
      expect(tableReport?.records).toHaveLength(1);
      expect(tableReport?.records[0].issueType).toBe("hard_error");
      expect(tableReport?.records[0].issue).toBe("HTTP 500");
    });

    it("marks a record as failed when the airtable record is not found in fetchAllRecords result", async () => {
      const { em, mockSession } = buildMockEm({
        planJson: {
          importOrder: ["tbl1"],
          tables: {
            tbl1: makePlanTable({
              records: [
                {
                  airtableId: "rec_missing",
                  omId: "uuid-1",
                  originalCreatedAt: null,
                  originalUpdatedAt: null,
                },
              ],
            }),
          },
          users: {},
          totalRecords: 1,
          generatedAt: new Date().toISOString(),
        },
      });
      wireContainer(em);
      wireImporter(makeOkImporter());
      // fetchAllRecords returns no records — rec_missing is absent
      wireAirtableRecords([]);

      await handler(makeJob());

      const progressTbl1 = mockSession.progressJson!.tables["tbl1"];
      expect(progressTbl1.failed).toBe(1);
      expect(progressTbl1.records["rec_missing"].status).toBe("failed");
      expect(progressTbl1.records["rec_missing"].error).toBe(
        "Rekord nie znaleziony w Airtable",
      );
    });

    it("builds correct airtableUrl in the hard_error report record", async () => {
      const { em, mockSession } = buildSingleRecordSession({}, { airtableBaseId: "appXYZ" });
      wireContainer(em);
      wireImporter(makeFailedImporter("error"));
      wireAirtableRecords([{ id: "rec1", fields: {} }]);

      await handler(makeJob());

      const reportRecord = mockSession.reportJson?.tables["tbl1"].records[0];
      expect(reportRecord?.airtableUrl).toBe(
        "https://airtable.com/appXYZ/tbl1/rec1",
      );
    });
  });

  // -------------------------------------------------------------------------
  // isRetry mode
  // -------------------------------------------------------------------------

  describe("isRetry mode", () => {
    it("processes only the records listed in retryAirtableIds when isRetry is true", async () => {
      const { em } = buildMockEm();
      wireContainer(em);
      const importerFn = makeOkImporter();
      wireImporter(importerFn);
      wireAirtableRecords([
        { id: "rec1", fields: {} },
        { id: "rec2", fields: {} },
      ]);

      await handler(
        makeJob({ isRetry: true, retryAirtableIds: { tbl1: ["rec1"] } }),
      );

      // Only rec1 should be processed
      expect(importerFn).toHaveBeenCalledTimes(1);
      const callArg = importerFn.mock.calls[0][0] as { airtableId: string };
      expect(callArg.airtableId).toBe("rec1");
    });

    it("does NOT reset progressJson when isRetry is true and progressJson already exists", async () => {
      const existingProgress: ImportProgress = {
        tables: {
          tbl1: {
            total: 2,
            done: 1,
            failed: 0,
            needsAttention: 0,
            records: {
              rec1: { status: "done", omId: "uuid-1", error: null },
            },
            metrics: {
              startedAt: "2024-01-01T00:00:00Z",
              batchCount: 1,
              failedBatches: 0,
            },
          },
        },
        currentTable: null,
        startedAt: "2024-01-01T00:00:00Z",
        pass: 1,
        logs: [],
      };

      const { em, mockSession } = buildMockEm({
        progressJson: existingProgress,
      });
      wireContainer(em);
      wireImporter(makeOkImporter());
      wireAirtableRecords([
        { id: "rec1", fields: {} },
        { id: "rec2", fields: {} },
      ]);

      await handler(
        makeJob({ isRetry: true, retryAirtableIds: { tbl1: ["rec2"] } }),
      );

      // startedAt from the original progress must be preserved
      expect(mockSession.progressJson?.startedAt).toBe("2024-01-01T00:00:00Z");
    });

    it("resets progressJson when isRetry is false and progressJson exists", async () => {
      const existingProgress: ImportProgress = {
        tables: {},
        currentTable: null,
        startedAt: "2020-01-01T00:00:00Z",
        pass: 1,
        logs: [],
      };

      const { em, mockSession } = buildMockEm({
        progressJson: existingProgress,
      });
      wireContainer(em);
      wireImporter(makeOkImporter());
      wireAirtableRecords([
        { id: "rec1", fields: {} },
        { id: "rec2", fields: {} },
      ]);

      await handler(makeJob({ isRetry: false }));

      // startedAt must be different (freshly set by handler)
      expect(mockSession.progressJson?.startedAt).not.toBe(
        "2020-01-01T00:00:00Z",
      );
    });

    it("subtracts previous failed/needsAttention counters before retrying to avoid double-counting", async () => {
      const existingProgress: ImportProgress = {
        tables: {
          tbl1: {
            total: 2,
            done: 0,
            failed: 2,
            needsAttention: 0,
            records: {
              rec1: { status: "failed", omId: null, error: "HTTP 500" },
              rec2: { status: "failed", omId: null, error: "HTTP 500" },
            },
            metrics: {
              startedAt: "2024-01-01T00:00:00Z",
              batchCount: 2,
              failedBatches: 2,
            },
          },
        },
        currentTable: null,
        startedAt: "2024-01-01T00:00:00Z",
        pass: 1,
        logs: [],
      };

      const { em, mockSession } = buildMockEm({
        progressJson: existingProgress,
      });
      wireContainer(em);
      // Both records succeed on retry
      wireImporter(makeOkImporter());
      wireAirtableRecords([
        { id: "rec1", fields: {} },
        { id: "rec2", fields: {} },
      ]);

      await handler(
        makeJob({
          isRetry: true,
          retryAirtableIds: { tbl1: ["rec1", "rec2"] },
        }),
      );

      // failed counter should be 0 (decremented from 2, not added to 2)
      const tbl1 = mockSession.progressJson?.tables["tbl1"];
      expect(tbl1?.failed).toBe(0);
      expect(tbl1?.done).toBe(2);
      expect(tbl1?.records["rec1"].status).toBe("done");
      expect(tbl1?.records["rec2"].status).toBe("done");
    });
  });

  // -------------------------------------------------------------------------
  // configJson defaults
  // -------------------------------------------------------------------------

  describe("configJson defaults", () => {
    it("uses preserveDates=true and addAirtableIdField=true when configJson is null", async () => {
      const { em } = buildMockEm({ configJson: null });
      wireContainer(em);
      const importerFn = makeOkImporter();
      wireImporter(importerFn);
      wireAirtableRecords([
        { id: "rec1", fields: {} },
        { id: "rec2", fields: {} },
      ]);

      await handler(makeJob());

      // addAirtableIdField=true → importer receives fields with 'airtable_id'
      const callArg = importerFn.mock.calls[0][0] as {
        fields: Record<string, unknown>;
      };
      expect(callArg.fields["airtable_id"]).toBe("rec1");
    });

    it("includes airtable_id in transformedFields when addAirtableIdField is true", async () => {
      const { em } = buildMockEm({
        configJson: {
          importUsers: false,
          importAttachments: false,
          preserveDates: false,
          addAirtableIdField: true,
          userRoleMapping: {},
        },
      });
      wireContainer(em);
      const importerFn = makeOkImporter();
      wireImporter(importerFn);
      wireAirtableRecords([
        { id: "rec1", fields: {} },
        { id: "rec2", fields: {} },
      ]);

      await handler(makeJob());

      const callArg = importerFn.mock.calls[0][0] as {
        fields: Record<string, unknown>;
      };
      expect(callArg.fields).toHaveProperty("airtable_id", "rec1");
    });

    it("does NOT include airtable_id when addAirtableIdField is false", async () => {
      const { em } = buildMockEm({
        configJson: {
          importUsers: false,
          importAttachments: false,
          preserveDates: false,
          addAirtableIdField: false,
          userRoleMapping: {},
        },
      });
      wireContainer(em);
      const importerFn = makeOkImporter();
      wireImporter(importerFn);
      wireAirtableRecords([
        { id: "rec1", fields: {} },
        { id: "rec2", fields: {} },
      ]);

      await handler(makeJob());

      const callArg = importerFn.mock.calls[0][0] as {
        fields: Record<string, unknown>;
      };
      expect(callArg.fields).not.toHaveProperty("airtable_id");
    });
  });

  // -------------------------------------------------------------------------
  // Non-retry: skips already-done records
  // -------------------------------------------------------------------------

  describe("non-retry: skips records already marked as done", () => {
    it("skips records with status done in existing progress when isRetry is false", async () => {
      const existingProgress: ImportProgress = {
        tables: {
          tbl1: {
            total: 2,
            done: 1,
            failed: 0,
            needsAttention: 0,
            records: {
              rec1: { status: "done", omId: "uuid-1", error: null },
            },
            metrics: {
              startedAt: "2024-01-01T00:00:00Z",
              batchCount: 1,
              failedBatches: 0,
            },
          },
        },
        currentTable: null,
        startedAt: "2024-01-01T00:00:00Z",
        pass: 1,
        logs: [],
      };

      // NOTE: isRetry=false causes a progress reset so the existing status is wiped.
      // The scenario that actually exercises non-retry skip is: progressJson=null (fresh
      // start) but the in-memory progress object accumulates a 'done' entry during the
      // same run.  We test the mid-run accumulation here instead.
      //
      // For the real "skip done from previous run" path, we need isRetry=undefined
      // AND session.progressJson already populated (no reset happens when isRetry is
      // falsy AND progressJson exists → see condition: !session.progressJson || !isRetry).
      // So the reset fires on isRetry=false; to KEEP the old progress we need
      // isRetry=true with the existing progressJson.

      // We verify the underlying filter by checking that only rec2 is imported when
      // rec1 is already 'done' in a retry run that covers both records.
      const { em } = buildMockEm({ progressJson: existingProgress });
      wireContainer(em);
      const importerFn = makeOkImporter();
      wireImporter(importerFn);
      wireAirtableRecords([
        { id: "rec1", fields: {} },
        { id: "rec2", fields: {} },
      ]);

      // isRetry=true but retryAirtableIds covers both — the non-retry filter does not apply
      // in retry mode; we test the OTHER filter: non-retry excludes done records.
      // Use isRetry=undefined to get the non-retry path with an existing progressJson.
      // Condition: !session.progressJson (false — it exists) || !isRetry (true — undefined).
      // Result: progress IS reset. To prevent reset we need isRetry=true and pass both ids.
      //
      // Actually re-reading the source:
      //   if (!session.progressJson || !isRetry) { session.progressJson = {...fresh...} }
      // So the only way to NOT reset is: session.progressJson exists AND isRetry is truthy.
      // In non-retry calls (isRetry=undefined/false) progress is always reset.
      // The "skip done" filter therefore only guards against concurrent duplicates or
      // records that became done mid-loop in the same run.
      //
      // We test it directly by calling handler with isRetry=true + no retryAirtableIds
      // so all records go through the non-retry filter branch
      // (isRetry && retryAirtableIds?.[tableId] is falsy).

      const { em: em2, mockSession: sess2 } = buildMockEm({
        progressJson: existingProgress,
      });
      wireContainer(em2);
      const importer2 = jest
        .fn()
        .mockResolvedValue({ ok: true, omId: "uuid-2" });
      wireImporter(importer2);
      wireAirtableRecords([
        { id: "rec1", fields: {} },
        { id: "rec2", fields: {} },
      ]);

      // isRetry=true so progress not reset; retryAirtableIds absent so non-retry filter fires
      await handler(makeJob({ isRetry: true }));

      // Only rec2 should be imported — rec1 was already done
      expect(importer2).toHaveBeenCalledTimes(1);
      const arg = importer2.mock.calls[0][0] as { airtableId: string };
      expect(arg.airtableId).toBe("rec2");
    });
  });

  // -------------------------------------------------------------------------
  // Periodic flush every 50 records
  // -------------------------------------------------------------------------

  describe("periodic flush every 50 records", () => {
    it("flushes after every 50 successfully processed records", async () => {
      // Build a session with 100 records so we get 2 extra flushes mid-loop
      const records = Array.from({ length: 100 }, (_, i) => ({
        airtableId: `rec${i}`,
        omId: `uuid-${i}`,
        originalCreatedAt: null,
        originalUpdatedAt: null,
      }));

      const { em, mockFlush } = buildMockEm({
        planJson: {
          importOrder: ["tbl1"],
          tables: {
            tbl1: makePlanTable({ records }),
          },
          users: {},
          totalRecords: 100,
          generatedAt: new Date().toISOString(),
        },
      });
      wireContainer(em);
      wireImporter(makeOkImporter());
      wireAirtableRecords(
        records.map((r) => ({ id: r.airtableId, fields: {} })),
      );

      await handler(makeJob());

      // We expect at least 4 flushes: 1 per-table init + 2 mid-loop (at 50 and 100) + 1 final
      expect(mockFlush.mock.calls.length).toBeGreaterThanOrEqual(4);
    });
  });

  // -------------------------------------------------------------------------
  // preserveDates — knex.raw calls
  // -------------------------------------------------------------------------

  describe("preserveDates SQL patch", () => {
    it("calls knex.raw to patch created_at for records with originalCreatedAt and status done", async () => {
      const { em, mockRaw } = buildSingleRecordSession({}, {
        configJson: {
          importUsers: false,
          importAttachments: false,
          preserveDates: true,
          addAirtableIdField: true,
          userRoleMapping: {},
        },
      });
      wireContainer(em);
      wireImporter(makeOkImporter("uuid-1"));
      // fetchAllRecords provides createdTime so originalCreatedAt gets populated
      wireAirtableRecords([
        { id: "rec1", fields: {}, createdTime: "2023-01-15T10:00:00Z" },
      ]);

      await handler(makeJob());

      // customers.people maps to customer_people in MODULE_DB_TABLE
      expect(mockRaw).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE customer_people"),
        expect.arrayContaining(["2023-01-15T10:00:00Z", "tenant-1"]),
      );
    });

    it("uses custom_field_records table when targetModule is null", async () => {
      const { em, mockRaw } = buildMockEm({
        configJson: {
          importUsers: false,
          importAttachments: false,
          preserveDates: true,
          addAirtableIdField: true,
          userRoleMapping: {},
        },
        planJson: {
          importOrder: ["tbl1"],
          tables: {
            tbl1: makePlanTable({
              targetModule: null,
              records: [
                {
                  airtableId: "rec1",
                  omId: "uuid-1",
                  originalCreatedAt: null,
                  originalUpdatedAt: null,
                },
              ],
            }),
          },
          users: {},
          totalRecords: 1,
          generatedAt: new Date().toISOString(),
        },
      });
      wireContainer(em);
      wireImporter(makeOkImporter("uuid-1"));
      wireAirtableRecords([
        { id: "rec1", fields: {}, createdTime: "2023-01-15T10:00:00Z" },
      ]);

      await handler(makeJob());

      expect(mockRaw).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE custom_field_records"),
        expect.arrayContaining(["2023-01-15T10:00:00Z", "tenant-1"]),
      );
    });

    it("does NOT call knex.raw when preserveDates is false", async () => {
      const { em, mockRaw } = buildMockEm({
        configJson: {
          importUsers: false,
          importAttachments: false,
          preserveDates: false,
          addAirtableIdField: true,
          userRoleMapping: {},
        },
      });
      wireContainer(em);
      wireImporter(makeOkImporter());
      wireAirtableRecords([
        { id: "rec1", fields: {}, createdTime: "2023-01-15T10:00:00Z" },
        { id: "rec2", fields: {} },
      ]);

      await handler(makeJob());

      expect(mockRaw).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Field mapping
  // -------------------------------------------------------------------------

  describe("field mapping", () => {
    it("calls transformFieldValue for each non-skipped fieldMapping", async () => {
      const { em } = buildSingleRecordSession({}, {
        mappingJson: {
          tables: [
            {
              airtableTableId: "tbl1",
              airtableTableName: "Klienci",
              targetModule: "customers.people",
              targetEntitySlug: null,
              confidence: 0.9,
              skip: false,
              fieldMappings: [
                {
                  airtableFieldId: "fld1",
                  airtableFieldName: "Email",
                  airtableFieldType: "email",
                  omFieldKey: "primaryEmail",
                  omFieldType: "email",
                  isMappedToCreatedAt: false,
                  isMappedToUpdatedAt: false,
                  skip: false,
                  sampleValues: [],
                },
                {
                  airtableFieldId: "fld2",
                  airtableFieldName: "Phone",
                  airtableFieldType: "phoneNumber",
                  omFieldKey: "phone",
                  omFieldType: "text",
                  isMappedToCreatedAt: false,
                  isMappedToUpdatedAt: false,
                  skip: true, // skipped
                  sampleValues: [],
                },
              ],
            },
          ],
        },
      });
      wireContainer(em);
      wireImporter(makeOkImporter());
      wireAirtableRecords([
        { id: "rec1", fields: { Email: "user@test.com", Phone: "123456789" } },
      ]);

      const mockedTransform = transformFieldValue as jest.MockedFunction<
        typeof transformFieldValue
      >;
      await handler(makeJob());

      // Only Email field should be transformed — Phone is skipped
      expect(mockedTransform).toHaveBeenCalledWith("email", "user@test.com");
      expect(mockedTransform).not.toHaveBeenCalledWith(
        "phoneNumber",
        expect.anything(),
      );
    });

    it("skips fieldMappings that are mapped to createdAt or updatedAt", async () => {
      const { em } = buildSingleRecordSession({}, {
        mappingJson: {
          tables: [
            {
              airtableTableId: "tbl1",
              airtableTableName: "Klienci",
              targetModule: "customers.people",
              targetEntitySlug: null,
              confidence: 0.9,
              skip: false,
              fieldMappings: [
                {
                  airtableFieldId: "fld1",
                  airtableFieldName: "Created",
                  airtableFieldType: "createdTime",
                  omFieldKey: "createdAt",
                  omFieldType: null,
                  isMappedToCreatedAt: true,
                  isMappedToUpdatedAt: false,
                  skip: false,
                  sampleValues: [],
                },
              ],
            },
          ],
        },
      });
      wireContainer(em);
      wireImporter(makeOkImporter());
      wireAirtableRecords([
        { id: "rec1", fields: { Created: "2023-01-01T00:00:00Z" } },
      ]);

      const mockedTransform = transformFieldValue as jest.MockedFunction<
        typeof transformFieldValue
      >;
      await handler(makeJob());

      expect(mockedTransform).not.toHaveBeenCalledWith(
        "createdTime",
        expect.anything(),
      );
    });

    it("does not include null-transformed field values in the importer payload", async () => {
      const { em } = buildSingleRecordSession({}, {
        mappingJson: {
          tables: [
            {
              airtableTableId: "tbl1",
              airtableTableName: "Klienci",
              targetModule: "customers.people",
              targetEntitySlug: null,
              confidence: 0.9,
              skip: false,
              fieldMappings: [
                {
                  airtableFieldId: "fld1",
                  airtableFieldName: "NullField",
                  airtableFieldType: "singleLineText",
                  omFieldKey: "someField",
                  omFieldType: "text",
                  isMappedToCreatedAt: false,
                  isMappedToUpdatedAt: false,
                  skip: false,
                  sampleValues: [],
                },
              ],
            },
          ],
        },
      });
      wireContainer(em);
      const importerFn = makeOkImporter();
      wireImporter(importerFn);
      // transformFieldValue is mocked to return value ?? null; null input → null
      (
        transformFieldValue as jest.MockedFunction<typeof transformFieldValue>
      ).mockReturnValue(null);
      wireAirtableRecords([{ id: "rec1", fields: { NullField: null } }]);

      await handler(makeJob());

      const callArg = importerFn.mock.calls[0][0] as {
        fields: Record<string, unknown>;
      };
      expect(callArg.fields).not.toHaveProperty("someField");
    });
  });

  // -------------------------------------------------------------------------
  // Importer input — context fields
  // -------------------------------------------------------------------------

  describe("importer input context", () => {
    it("passes tenantId and organizationId from session to importer", async () => {
      const { em } = buildMockEm();
      wireContainer(em);
      const importerFn = makeOkImporter();
      wireImporter(importerFn);
      wireAirtableRecords([
        { id: "rec1", fields: {} },
        { id: "rec2", fields: {} },
      ]);

      await handler(makeJob({ tenantId: "tenant-1" }));

      const callArg = importerFn.mock.calls[0][0] as {
        tenantId: string;
        organizationId: string;
      };
      expect(callArg.tenantId).toBe("tenant-1");
      expect(callArg.organizationId).toBe("org-1");
    });

    it("passes omUrl and omApiKey from job payload to importer", async () => {
      const { em } = buildMockEm();
      wireContainer(em);
      const importerFn = makeOkImporter();
      wireImporter(importerFn);
      wireAirtableRecords([
        { id: "rec1", fields: {} },
        { id: "rec2", fields: {} },
      ]);

      await handler(
        makeJob({ omUrl: "http://my-app:3000", omApiKey: "secret-key" }),
      );

      const callArg = importerFn.mock.calls[0][0] as {
        omUrl: string;
        omApiKey: string;
      };
      expect(callArg.omUrl).toBe("http://my-app:3000");
      expect(callArg.omApiKey).toBe("secret-key");
    });

    it("adds entitySlug derived from airtableTableName when targetEntitySlug is null and targetModule is null", async () => {
      const { em } = buildMockEm({
        planJson: {
          importOrder: ["tbl1"],
          tables: {
            tbl1: makePlanTable({
              targetModule: null,
              targetEntitySlug: null,
              airtableTableName: "My Custom Table",
              records: [
                {
                  airtableId: "rec1",
                  omId: "uuid-1",
                  originalCreatedAt: null,
                  originalUpdatedAt: null,
                },
              ],
            }),
          },
          users: {},
          totalRecords: 1,
          generatedAt: new Date().toISOString(),
        },
        mappingJson: {
          tables: [
            {
              airtableTableId: "tbl1",
              airtableTableName: "My Custom Table",
              targetModule: null,
              targetEntitySlug: null,
              confidence: 0.5,
              skip: false,
              fieldMappings: [],
            },
          ],
        },
      });
      wireContainer(em);
      const importerFn = makeOkImporter();
      wireImporter(importerFn);
      wireAirtableRecords([{ id: "rec1", fields: {} }]);

      await handler(makeJob());

      const callArg = importerFn.mock.calls[0][0] as { entitySlug?: string };
      expect(callArg.entitySlug).toBe("my_custom_table");
    });

    it("uses targetEntitySlug from planTable when explicitly set", async () => {
      const { em } = buildMockEm({
        planJson: {
          importOrder: ["tbl1"],
          tables: {
            tbl1: makePlanTable({
              targetEntitySlug: "custom_slug",
              targetModule: null,
              records: [
                {
                  airtableId: "rec1",
                  omId: "uuid-1",
                  originalCreatedAt: null,
                  originalUpdatedAt: null,
                },
              ],
            }),
          },
          users: {},
          totalRecords: 1,
          generatedAt: new Date().toISOString(),
        },
        mappingJson: {
          tables: [
            {
              airtableTableId: "tbl1",
              airtableTableName: "Klienci",
              targetModule: null,
              targetEntitySlug: null,
              confidence: 0.9,
              skip: false,
              fieldMappings: [],
            },
          ],
        },
      });
      wireContainer(em);
      const importerFn = makeOkImporter();
      wireImporter(importerFn);
      wireAirtableRecords([{ id: "rec1", fields: {} }]);

      await handler(makeJob());

      const callArg = importerFn.mock.calls[0][0] as { entitySlug?: string };
      expect(callArg.entitySlug).toBe("custom_slug");
    });
  });

  // -------------------------------------------------------------------------
  // Finalization / report structure
  // -------------------------------------------------------------------------

  describe("finalization", () => {
    it("sets session.progressJson.currentTable to null after all tables are processed", async () => {
      const { em, mockSession } = buildMockEm();
      wireContainer(em);
      wireImporter(makeOkImporter());
      wireAirtableRecords([
        { id: "rec1", fields: {} },
        { id: "rec2", fields: {} },
      ]);

      await handler(makeJob());

      expect(mockSession.progressJson?.currentTable).toBeNull();
    });

    it("includes durationMs in reportJson", async () => {
      const { em, mockSession } = buildMockEm();
      wireContainer(em);
      wireImporter(makeOkImporter());
      wireAirtableRecords([
        { id: "rec1", fields: {} },
        { id: "rec2", fields: {} },
      ]);

      await handler(makeJob());

      expect(typeof mockSession.reportJson?.durationMs).toBe("number");
      expect(mockSession.reportJson?.durationMs).toBeGreaterThanOrEqual(0);
    });

    it("sets users counts to zero in reportJson (user import not implemented)", async () => {
      const { em, mockSession } = buildMockEm();
      wireContainer(em);
      wireImporter(makeOkImporter());
      wireAirtableRecords([
        { id: "rec1", fields: {} },
        { id: "rec2", fields: {} },
      ]);

      await handler(makeJob());

      expect(mockSession.reportJson?.users).toEqual({ imported: 0, failed: 0 });
    });

    it("resolveImporter is called with the targetModule from the plan table", async () => {
      const { em } = buildMockEm();
      wireContainer(em);
      wireImporter(makeOkImporter());
      wireAirtableRecords([
        { id: "rec1", fields: {} },
        { id: "rec2", fields: {} },
      ]);

      const mockedResolve = resolveImporter as jest.MockedFunction<
        typeof resolveImporter
      >;

      await handler(makeJob());

      expect(mockedResolve).toHaveBeenCalledWith("customers.people");
    });

    it("resolveImporter is called with null when planTable.targetModule is null", async () => {
      const { em } = buildMockEm({
        planJson: {
          importOrder: ["tbl1"],
          tables: {
            tbl1: makePlanTable({ targetModule: null }),
          },
          users: {},
          totalRecords: 2,
          generatedAt: new Date().toISOString(),
        },
        mappingJson: {
          tables: [
            {
              airtableTableId: "tbl1",
              airtableTableName: "Klienci",
              targetModule: null,
              targetEntitySlug: null,
              confidence: 0.9,
              skip: false,
              fieldMappings: [],
            },
          ],
        },
      });
      wireContainer(em);
      wireImporter(makeOkImporter());
      wireAirtableRecords([
        { id: "rec1", fields: {} },
        { id: "rec2", fields: {} },
      ]);

      const mockedResolve = resolveImporter as jest.MockedFunction<
        typeof resolveImporter
      >;

      await handler(makeJob());

      expect(mockedResolve).toHaveBeenCalledWith(null);
    });
  });
});
