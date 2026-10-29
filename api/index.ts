import { randomUUID } from "node:crypto";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { createDriftnet } from "../packages/core/src/index.ts";
import { createApp } from "../apps/server/src/app.ts";
import { assertPrivateDataRepo, hydrateFromGithub, persistToGithub, remoteDataSha } from "./vercel-persistence.ts";

interface Runtime {
  server: Server;
  dbPath: string;
  sourceSha: string | null;
}

let runtimePromise: Promise<Runtime> | undefined;
let lastRemoteCheck = 0;
let writeTail: Promise<void> = Promise.resolve();

function configureEnvironment(): NodeJS.ProcessEnv {
  const env = process.env;
  env.DRIFTNET_ACCESS ||= "private";
  if (!env.DRIFTNET_TOKEN) throw new Error("DRIFTNET_TOKEN is required for a Vercel deployment");

  // Vercel exposes a deployment hostname without a scheme. The production URL
  // wins when present; previews fall back to the current deployment URL.
  if (!env.DRIFTNET_PUBLIC_URL) {
    const host = env.VERCEL_PROJECT_PRODUCTION_URL || env.VERCEL_URL;
    if (host) env.DRIFTNET_PUBLIC_URL = `https://${host}`;
  }
  return env;
}

async function buildRuntime(): Promise<Runtime> {
  const env = configureEnvironment();
  await assertPrivateDataRepo(env);

  // A Vercel Function filesystem is not durable. Each warm instance gets a
  // private temporary SQLite index; GitHub Markdown remains the source of truth.
  const dbPath = `/tmp/driftnet-${process.pid}-${randomUUID()}.db`;
  env.DRIFTNET_DB = dbPath;
  const hydrated = await hydrateFromGithub(dbPath, env);
  const dn = createDriftnet(env);
  const server = createApp({ dn, env, port: 0 });
  return { server, dbPath, sourceSha: hydrated.sourceSha };
}

function getRuntime(): Promise<Runtime> {
  return runtimePromise ??= buildRuntime().catch((err) => {
    runtimePromise = undefined;
    throw err;
  });
}

/**
 * Rewrites add the matched wildcard as ?dnPath=... at the destination. Restore
 * the URL that Driftnet's existing router expects before emitting the request.
 */
function restoreOriginalUrl(req: IncomingMessage): void {
  const current = new URL(req.url ?? "/api/index", "http://driftnet.local");
  const path = current.searchParams.get("dnPath");
  current.searchParams.delete("dnPath");
  const pathname = path ? `/${path.replace(/^\/+/, "")}` : "/";
  const query = current.searchParams.toString();
  req.url = query ? `${pathname}?${query}` : pathname;
}

function isMutating(req: IncomingMessage): boolean {
  return !["GET", "HEAD", "OPTIONS"].includes(req.method ?? "GET");
}

async function freshRuntime(forceCheck: boolean): Promise<Runtime> {
  let runtime = await getRuntime();
  const now = Date.now();
  // Reads use a short TTL so a new warm instance does not hammer GitHub on every
  // asset request. Writes always check immediately before changing local state.
  if (forceCheck || now - lastRemoteCheck > 5_000) {
    const sha = await remoteDataSha(process.env);
    lastRemoteCheck = now;
    if (sha !== runtime.sourceSha) {
      runtimePromise = undefined;
      runtime = await getRuntime();
      lastRemoteCheck = Date.now();
    }
  }
  return runtime;
}

async function waitForFinish(res: ServerResponse, server: Server, req: IncomingMessage): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const done = () => { cleanup(); resolve(); };
    const failed = (err: Error) => { cleanup(); reject(err); };
    const cleanup = () => {
      res.off("finish", done);
      res.off("error", failed);
    };
    res.once("finish", done);
    res.once("error", failed);
    server.emit("request", req, res);
  });
}

async function withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
  const previous = writeTail;
  let release!: () => void;
  writeTail = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try {
    return await fn();
  } finally {
    release();
  }
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  restoreOriginalUrl(req);
  const mutating = isMutating(req);

  const run = async () => {
    const runtime = await freshRuntime(mutating);
    res.setHeader("x-driftnet-storage", "github-markdown");
    await waitForFinish(res, runtime.server, req);

    if (mutating && res.statusCode >= 200 && res.statusCode < 400) {
      try {
        runtime.sourceSha = await persistToGithub(runtime.dbPath, process.env, runtime.sourceSha);
        lastRemoteCheck = Date.now();
      } catch (err) {
        // Do not silently let a stale warm instance overwrite a newer GitHub
        // copy. GitHub's expected SHA rejects the race; force a full rehydrate
        // for the next request and make the failure visible in Vercel logs.
        runtimePromise = undefined;
        console.error("[vercel-persistence] write was served but persistence failed:", err);
      }
    }
  };

  if (mutating) await withWriteLock(run);
  else await run();
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    await handle(req, res);
  } catch (err) {
    console.error("[vercel]", err);
    if (!res.headersSent) {
      res.statusCode = 503;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(JSON.stringify({
        error: "Driftnet Vercel runtime is not ready",
        detail: err instanceof Error ? err.message : String(err),
      }));
    } else if (!res.writableEnded) {
      res.end();
    }
  }
}
