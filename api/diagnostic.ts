import type { IncomingMessage, ServerResponse } from "node:http";

export default async function handler(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  const checks: Record<string, string> = {};
  const run = async (name: string, load: () => Promise<unknown>) => {
    try {
      await load();
      checks[name] = "ok";
    } catch (err) {
      checks[name] = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    }
  };

  await run("node:sqlite", () => import("node:sqlite"));
  await run("core-relative", () => import("../packages/core/src/index.ts"));
  await run("core-workspace", () => import("@driftnet/core"));
  await run("server-app", () => import("../apps/server/src/app.ts"));
  await run("vercel-persistence", () => import("./vercel-persistence.ts"));

  res.statusCode = 200;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify({ node: process.version, checks }, null, 2));
}
