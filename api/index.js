let handlerPromise;

async function loadHandler() {
  return handlerPromise ??= import("../vercel-dist/driftnet-handler.mjs")
    .then((mod) => mod.default)
    .catch((err) => {
      handlerPromise = undefined;
      throw err;
    });
}

export default async function handler(req, res) {
  try {
    const run = await loadHandler();
    return await run(req, res);
  } catch (err) {
    console.error("[vercel-loader]", err);
    res.statusCode = 500;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify({
      error: "Driftnet bundle failed to load",
      detail: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    }));
  }
}
