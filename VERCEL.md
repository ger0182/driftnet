# Deploy Driftnet on Vercel with GitHub Markdown storage

This deployment mode keeps Driftnet's existing UI, routes, folders, search and history model while moving durable state out of Vercel's ephemeral filesystem and into a separate private GitHub repository.

## Architecture

```text
Browser / agents
      |
      v
Vercel Function (api/index.js -> bundled handler)
      |
      +-- /tmp/driftnet-*.db   temporary SQLite runtime index
      |
      `-- GitHub Contents API
              |
              v
        PRIVATE data repo
        data/driftnet-state.md   canonical durable state
```

The SQLite file under `/tmp` is disposable. Every new Vercel runtime hydrates it from the Markdown snapshot. After a successful mutating request, Driftnet commits the logical tables back to GitHub.

`item_fts` and `item_vec` are intentionally not persisted. Full-text search is rebuilt from canonical data during hydration; semantic vectors are derived data and can be regenerated.

## 1. Create a private data repository

Create a **private** repository, for example:

```text
ger0182/driftnet-data
```

Do not use the public `ger0182/driftnet` repository for persisted data. Notes, share context, internal state and token hashes can be part of the snapshot.

The repository must have a real default branch before Driftnet can write through the GitHub Contents API. If it is completely empty, initialize it with a README first.

On the first Vercel boot, if `data/driftnet-state.md` does not exist, Driftnet initializes its temporary SQLite database and immediately writes the first canonical Markdown snapshot. No manual data mutation is required to create the first snapshot.

## 2. Create a fine-grained GitHub token

Create a fine-grained personal access token limited to the private data repository.

Required repository permissions:

- Metadata: Read
- Contents: Read and write

Do not commit this token to either repository.

## 3. Import Driftnet into Vercel

Import `ger0182/driftnet` as a Vercel project. For the first test, deploy the `vercel-markdown-storage` branch as a Preview deployment.

The repository root is the Vercel project root. `vercel.json` sends public paths to the serverless entrypoint, which restores the original request path and hands the request to Driftnet's existing Node HTTP router. The deployment build bundles the monorepo TypeScript into JavaScript before Vercel executes it.

## 4. Configure Vercel environment variables

Required:

```text
DRIFTNET_ACCESS=private
DRIFTNET_TOKEN=<strong random admin token>
DRIFTNET_GITHUB_TOKEN=<fine-grained GitHub token>
DRIFTNET_DATA_REPO=ger0182/driftnet-data
DRIFTNET_DATA_BRANCH=main
DRIFTNET_DATA_PATH=data/driftnet-state.md
```

Store `DRIFTNET_TOKEN` and `DRIFTNET_GITHUB_TOKEN` as Vercel Sensitive environment variables.

`DRIFTNET_PUBLIC_URL` is optional on Vercel. When it is absent, the adapter derives it from `VERCEL_PROJECT_PRODUCTION_URL` or `VERCEL_URL`.

The adapter refuses to start if `DRIFTNET_DATA_REPO` is public. `DRIFTNET_ALLOW_PUBLIC_DATA_REPO=1` exists only as an explicit safety override and should normally remain unset.

## 5. Verify the Preview deployment

Check these in order:

1. Open `/` and confirm the Driftnet UI loads.
2. Confirm the response includes `x-driftnet-storage: github-markdown`.
3. Open the private data repository and confirm `data/driftnet-state.md` exists after the first boot.
4. Sign in with `DRIFTNET_TOKEN` and add one test item or note.
5. Confirm GitHub shows a new `data: persist Driftnet ...` commit.
6. Redeploy or open a fresh Preview instance and confirm the saved data is restored.

## Important Vercel-mode differences

### Settings page

Vercel environment variables are the durable configuration source. Settings that try to rewrite a local `.env` file cannot be relied on after the Function instance is recycled. Change secrets and environment configuration in the Vercel project settings instead.

### Background processes

`apps/server/src/main.ts` is not run in this mode. Long-running local processes such as Cloudflare Tunnel startup, socket-mode bots and in-process schedulers are therefore not started by the Vercel adapter. HTTP routes and the web UI continue to use the existing `createApp()` router.

### Backup files

Local filesystem backups are temporary on Vercel. The private GitHub data repository and its Git history are the durable backup trail for this deployment mode.

### Concurrent writes

Each persisted update is sent with the GitHub blob SHA that the Vercel runtime hydrated from. GitHub therefore rejects a stale concurrent overwrite instead of silently replacing newer data. The adapter checks for a newer remote snapshot before writes and rebuilds a stale runtime. A very narrow race between two separate Vercel instances can still cause one persistence attempt to be rejected; such failures are logged and the next request rehydrates from GitHub.

For a single-user/private Driftnet instance this is an acceptable first-stage migration. If write concurrency grows, move the commit operation behind a serialized queue or a transactional external store.

## Data format

The Markdown file contains a versioned JSON snapshot of the canonical Driftnet tables:

```text
# Driftnet data snapshot

<!-- DRIFTNET_STATE_BEGIN -->
{
  "driftnetSnapshot": 1,
  "schema": 7,
  "updatedAt": "...",
  "tables": { ... }
}
<!-- DRIFTNET_STATE_END -->
```

The GitHub Contents API transports the Markdown file as base64, but the file stored in the repository is ordinary readable Markdown containing JSON. SQLite on Vercel remains only a temporary runtime index.

This first Vercel migration uses one canonical Markdown snapshot so all current Driftnet features can be preserved without rewriting the mature SQLite-backed `Store`. A later migration can split cards/notes into individual Markdown files while keeping the same Vercel/GitHub boundary.
