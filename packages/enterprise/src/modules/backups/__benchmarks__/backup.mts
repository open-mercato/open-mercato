import { mkdir, chmod, writeFile, readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";
import { Client } from "pg";
import {
  createBackup,
  verifyBackup,
  restoreBackup,
  createPostgresSource,
  createPostgresTarget,
  decryptFile,
} from "../lib/engine/index";
import {
  encryptStream,
  generateX25519Identity,
  identityToRecipient,
} from "../lib/engine/crypto";
import { atomicStream } from "../lib/engine/artifacts";
import { progressRenderer } from "../lib/engine/progress";
import type { ProgressEvent } from "../lib/engine/types";
if (process.env.OM_BACKUP_BENCHMARK_ISOLATED !== "true")
  throw new Error(
    "Run only in the documented disposable Docker fixture with OM_BACKUP_BENCHMARK_ISOLATED=true",
  );
const root = "/bench";
const native = {
  sourceService: "source",
  targetService: "target",
  binariesDir: "/usr/lib/postgresql/16/bin",
  serviceFile: root + "/service.conf",
  passwordFile: root + "/password",
};
const gib = Number(process.argv[2] ?? "1");
if (![1, 20].includes(gib))
  throw new Error("Only isolated1GiB/20GiB fixtures supported");
const rows = gib * 16384;
const reuse = process.argv.includes("--reuse-source");
const cold = process.argv.includes("--cache-cold");
const rendererCpu = { backup: 0, verify: 0, restore: 0 };
let renderedBytes = 0;
function progress(phase: keyof typeof rendererCpu) {
  const render = progressRenderer('plain', { write(text) { renderedBytes += Buffer.byteLength(String(text)); return true; } });
  return (event: ProgressEvent) => {
    const start = process.cpuUsage();
    render(event);
    const elapsed = process.cpuUsage(start);
    rendererCpu[phase] += (elapsed.user + elapsed.system) / 1000;
  };
}
let peak = process.memoryUsage().rss;
const sample = setInterval(() => {
  peak = Math.max(peak, process.memoryUsage().rss);
}, 50);
sample.unref();
async function command(name: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(native.binariesDir + "/" + name, args, {
      env: {
        PGSERVICEFILE: native.serviceFile,
        PGPASSFILE: native.passwordFile,
        PATH: native.binariesDir,
      },
      stdio: ["ignore", "ignore", "pipe"],
    });
    let error = "";
    child.stderr.on("data", (b) => {
      if (error.length < 4096) error += b;
    });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error("Native benchmark failed " + error)),
    );
  });
}
async function* dump() {
  const child = spawn(
    native.binariesDir + "/pg_dump",
    [
      "--dbname",
      "service=source",
      "--format=custom",
      "--no-owner",
      "--no-acl",
      "--no-tablespaces",
    ],
    {
      env: {
        PGSERVICEFILE: native.serviceFile,
        PGPASSFILE: native.passwordFile,
        PATH: native.binariesDir,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.stderr.on("data", () => undefined);
  const done = new Promise<number | null>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
  for await (const b of child.stdout) yield Buffer.from(b);
  if ((await done) !== 0) throw new Error("Native dump failed");
}
async function main() {
  await mkdir(root, { recursive: true, mode: 0o700 });
  await chmod(root, 0o700);
  await writeFile(
    native.serviceFile,
    ["source", "target", "baseline"]
      .map(
        (database) =>
          `[${database}]\nhost=127.0.0.1\nport=5432\ndbname=${database}\nuser=postgres\nsslmode=disable\n`,
      )
      .join(""),
    { mode: 0o600 },
  );
  await writeFile(
    native.passwordFile,
    "*:*:*:postgres:" + process.env.POSTGRES_PASSWORD + "\n",
    { mode: 0o600 },
  );
  const admin = new Client({
    host: "127.0.0.1",
    port: 5432,
    database: "postgres",
    user: "postgres",
    password: process.env.POSTGRES_PASSWORD,
  });
  await admin.connect();
  for (const db of reuse
    ? ["target", "baseline"]
    : ["source", "target", "baseline"]) {
    await admin.query(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${db} TEMPLATE template0`);
  }
  await admin.end();
  const source = new Client({
    host: "127.0.0.1",
    port: 5432,
    database: "source",
    user: "postgres",
    password: process.env.POSTGRES_PASSWORD,
  });
  await source.connect();
  if (!reuse) {
    await source.query(
      "CREATE UNLOGGED TABLE fixture(id bigint PRIMARY KEY,payload text); ALTER TABLE fixture ALTER COLUMN payload SET STORAGE EXTERNAL",
    );
    const seeded = performance.now();
    await source.query(
      `INSERT INTO fixture SELECT n,repeat(md5(n::text),2048) FROM generate_series(1,${rows}) n`,
    );
    await source.query("ANALYZE fixture");
    console.log(
      JSON.stringify({
        phase: "seeded",
        gib,
        rows,
        elapsedMs: Math.round(performance.now() - seeded),
      }),
    );
  }
  const expected = cold
    ? JSON.parse(
        await readFile(
          "/var/lib/postgresql/data/benchmark-expected.json",
          "utf8",
        ),
      ).expected
    : (
        await source.query(
          `SELECT count(*)::text AS rows,sum(octet_length(payload))::text AS bytes,sum(id)::text AS ids,md5(string_agg(md5(id::text || ':' || payload),'' ORDER BY id)) AS content_digest FROM fixture`,
        )
      ).rows[0];
  if (!cold)
    await writeFile(
      "/var/lib/postgresql/data/benchmark-expected.json",
      JSON.stringify({ gib, expected }),
      { mode: 0o600 },
    );
  await source.end();
  if (BigInt(expected.bytes) !== BigInt(gib) * 1073741824n)
    throw new Error("Fixture size differs from requested benchmark size");
  const identity = await generateX25519Identity();
  const recipients = [await identityToRecipient(identity)];
  await writeFile(root + "/synthetic-escrow.identity", identity, {
    mode: 0o600,
  });
  await mkdir(root + "/workspace", { recursive: true, mode: 0o700 });
  await mkdir(root + "/output", { recursive: true, mode: 0o700 });
  let started = performance.now();
  const backup = await createBackup({
    source: createPostgresSource(native),
    progress: progress("backup"),
    output: root + "/output",
    workspace: root + "/workspace",
    recipients,
    quiesced: true,
    chunkSizeBytes: 64 * 1024 * 1024,
    reserveBytes: 0n,
  });
  const backupMs = performance.now() - started;
  console.log(
    JSON.stringify({
      phase: "backup",
      gib,
      elapsedMs: Math.round(backupMs),
      rss: peak,
    }),
  );
  started = performance.now();
  const verified = await verifyBackup({
    progress: progress("verify"),
    artifact: backup.artifactPath,
    trustedManifestSha256: backup.manifestSha256,
    identities: [identity],
    binariesDir: native.binariesDir,
    workspace: root + "/workspace",
  });
  const verifyMs = performance.now() - started;
  const target = createPostgresTarget(native);
  const confirmation = await target.challenge({
    backupId: backup.backupId,
    manifestSha256: backup.manifestSha256,
    sourceIdentity: verified.index.identity,
  });
  started = performance.now();
  await restoreBackup({
    progress: progress("restore"),
    target,
    artifact: backup.artifactPath,
    trustedManifestSha256: backup.manifestSha256,
    identities: [identity],
    confirmation,
    binariesDir: native.binariesDir,
    workspace: root + "/workspace",
    maxStagingBytes: 1024 * 1024 * 1024,
  });
  const restoreMs = performance.now() - started;
  console.log(
    JSON.stringify({
      phase: "restore",
      gib,
      elapsedMs: Math.round(restoreMs),
      rss: peak,
    }),
  );
  const restored = new Client({
    host: "127.0.0.1",
    port: 5432,
    database: "target",
    user: "postgres",
    password: process.env.POSTGRES_PASSWORD,
  });
  await restored.connect();
  const actual = (
    await restored.query(
      `SELECT count(*)::text AS rows,sum(octet_length(payload))::text AS bytes,sum(id)::text AS ids,md5(string_agg(md5(id::text || ':' || payload),'' ORDER BY id)) AS content_digest FROM fixture`,
    )
  ).rows[0];
  await restored.end();
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error("Benchmark data mismatch");
  started = performance.now();
  await atomicStream(
    root + "/baseline.age",
    await encryptStream(dump(), recipients),
  );
  const baselineBackupMs = performance.now() - started;
  started = performance.now();
  await decryptFile({
    sourcePath: root + "/baseline.age",
    destinationPath: root + "/baseline.dump",
    identities: [identity],
  });
  await command("pg_restore", [
    "--dbname",
    "service=baseline",
    "--no-owner",
    "--no-acl",
    "--no-tablespaces",
    root + "/baseline.dump",
  ]);
  const baselineRestoreMs = performance.now() - started;
  const report = {
    gib,
    expected,
    logicalBytes: expected.bytes,
    rows: expected.rows,
    backupMs: Math.round(backupMs),
    verifyMs: Math.round(verifyMs),
    restoreMs: Math.round(restoreMs),
    baselineBackupMs: Math.round(baselineBackupMs),
    baselineRestoreMs: Math.round(baselineRestoreMs),
    maxRssMiB: Math.round(peak / 1024 / 1024),
    completeOrderedContentDigestEqual: true,
    rssBudgetPass: peak <= 256 * 1024 * 1024,
    backupLatencyPass: backupMs <= baselineBackupMs * 1.3 + 30000,
    restoreLatencyPass: restoreMs <= baselineRestoreMs * 1.3 + 30000,
    progress: { mode: 'plain', sink: 'byte-counting; terminal device I/O excluded', renderedBytes, cpuMs: rendererCpu, backupCpuPercent: rendererCpu.backup / backupMs * 100, restoreCpuPercent: rendererCpu.restore / restoreMs * 100, cpuBudgetPass: rendererCpu.backup / backupMs <= 0.02 && rendererCpu.restore / restoreMs <= 0.02 },
    runner: "Docker4vCPU8GiB/PostgreSQL16/Node24",
    cacheProtocol: cold
      ? "PostgreSQL stopped; task-volume clean-file cache eviction; fresh PostgreSQL shared buffers"
      : "after-seeding; no forced eviction",
    fixture:
      "64KiB per row, EXTERNAL storage, repetitive generated synthetic content",
  };
  await writeFile(root + "/report.json", JSON.stringify(report, null, 2), {
    mode: 0o600,
  });
  console.log(JSON.stringify(report));
}
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => clearInterval(sample));
