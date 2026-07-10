# ai.STARTUPJURY

_Venture intelligence first._ — an AI-powered pitch-deck evaluation platform for
incubators/accelerators and VCs, built full-stack on Cloudflare.

## Stack

- **Cloudflare Workers** (single Worker serves the React SPA + `/api/*`) via the
  [Cloudflare Vite plugin](https://developers.cloudflare.com/workers/vite-plugin/)
- **Hono** API · **React 19 + Vite** SPA · **TypeScript**
- **D1** (database) · **R2** (pitch-deck files) · **KV** (sessions) · **Queues** (async AI
  eval) — added across phases
- **Claude (Anthropic API)** called from the Worker for deck extraction + rubric scoring

## Requirements

- **Node 22+** (`nvm use` — the repo pins it via `.nvmrc`)
- Cloudflare account with `wrangler` authenticated

## Getting started

```bash
nvm use
npm install
npm run dev          # http://localhost:5173
```

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Local dev (SPA + Worker + local bindings via Miniflare) |
| `npm run build` | Build Worker + SPA to `dist/` |
| `npm run deploy` | Build + `wrangler deploy` |
| `npm run typecheck` | Type-check client, worker, and tooling configs |
| `npm run lint` | ESLint |
| `npm test` | Vitest — unit + Worker integration |
| `npm run test:e2e` | Playwright e2e |

## Project layout

```
src/client/    React SPA
src/server/    Hono API (Worker entry), ai/, queue, scheduled (later phases)
src/shared/    Types + logic shared client/server (roles, stages, scoring)
src/pipeline/  Shared pipeline state machine (incubator + VC) — Phase 1
migrations/    D1 SQL migrations — Phase 1
test/          unit/ + worker/ tests · e2e/ Playwright specs
```

Build progress and resume instructions live in [`HANDOFF.md`](./HANDOFF.md).
