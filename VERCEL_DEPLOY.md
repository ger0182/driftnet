# Vercel deployment

Driftnet can run on Vercel while keeping durable application state in a separate private GitHub repository.

## Architecture

- Vercel runs the Driftnet HTTP application as a serverless function.
- SQLite is restored into `/tmp` for each function instance and is only a runtime cache/index.
- Durable state is stored in a private GitHub repository as `data/driftnet-state.md`.
- The Markdown file contains a versioned base64 SQLite snapshot so existing Driftnet search, folders, history, tokens, and other storage behavior remain compatible.
- Successful mutating requests are serialized and persisted back to GitHub.
- New function instances hydrate from the latest GitHub snapshot.

Keep the data repository **private**. The deployment refuses to use a public data repository.

## Required Vercel environment variables

| Variable | Purpose |
| --- | --- |
| `DRIFTNET_ACCESS` | Set to `private` for a private deployment. |
| `DRIFTNET_TOKEN` | Driftnet access token. Store as a Sensitive variable. |
| `DRIFTNET_GITHUB_TOKEN` | Fine-grained GitHub token with Contents read/write access to only the data repository. Store as Sensitive. |
| `DRIFTNET_DATA_REPO` | Private data repository, for example `ger0182/driftnet-data`. |
| `DRIFTNET_DATA_BRANCH` | Data branch. Defaults to `main`. |
| `DRIFTNET_DATA_PATH` | Snapshot file. Defaults to `data/driftnet-state.md`. |

`DRIFTNET_PUBLIC_URL` is optional on Vercel. When omitted, the runtime derives it from Vercel's deployment URL.

## GitHub token permissions

Use a fine-grained personal access token scoped to only the private data repository with:

- Contents: Read and write
- Metadata: Read-only

Do not commit either token to this repository.

## First deployment

The data repository must have a real default branch. If it is completely empty, initialize it with a README first.

On first boot, when no remote snapshot exists, Driftnet initializes its local `/tmp` database and immediately writes the canonical Markdown snapshot to GitHub. Later instances restore that snapshot before serving requests.

## Local / Docker deployment

The existing Docker and local SQLite flows remain unchanged. The GitHub Markdown persistence adapter is only used by the Vercel entrypoint.
