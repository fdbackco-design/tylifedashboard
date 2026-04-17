# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Development server
npm run build        # Production build
npm run lint         # ESLint checks
npm run type-check   # TypeScript validation (noEmit)
```

No test framework is configured. Type checking and linting are the primary correctness checks.

## Architecture Overview

**tylifedashboard** is a Next.js App Router admin dashboard that syncs contract data from an external TY Life system (accessed via HTML scraping) into Supabase PostgreSQL, then displays it for settlement calculations and org management.

### Data Pipeline

```
TY Life (legacy HTML pages)
  → lib/tylife/client.ts        # Session cookie HTTP client
  → lib/tylife/html-parser.ts   # node-html-parser (server-only)
  → lib/tylife/normalize.ts     # Raw HTML → domain models
  → lib/tylife/sync-service.ts  # Main orchestration (upsert order below)
  → Supabase (service_role key, bypasses RLS)
  → Server Components / Route Handlers (anon key, RLS-protected)
  → UI Pages
```

Upsert order is FK-constrained: `members → edges → customers → contracts → histories`

### Route Structure

- `src/app/(admin)/` — Route group with sidebar layout. All pages here are the main UI.
- `src/app/api/` — Route handlers for data mutations and sync triggering.
- `src/lib/tylife/` — All external system integration logic (server-only).
- `src/lib/settlement/` — Commission calculation engine (direct contracts + org rollup).
- `src/lib/organization/` — Org tree display and hierarchy logic.
- `src/lib/supabase/` — Two clients: `client.ts` (browser, anon key) and `server.ts` (server, anon + service_role).
- `src/lib/types/` — Central domain types; re-exported from `index.ts`.
- `src/components/org-tree/` — Only shared UI component; recursive tree rendering.

### Key Architectural Patterns

**Server Components by default** — Pages fetch directly from Supabase without going through API routes. API routes exist only for mutations and sync triggers.

**Two Supabase clients**:
- Browser client (`NEXT_PUBLIC_SUPABASE_ANON_KEY`) — used in Client Components, RLS-protected
- Server admin client (`SUPABASE_SERVICE_ROLE_KEY`) — bypasses RLS, used in sync and mutations only

**Settlement calculation** — Two-part: direct commission from member's own contracts + organizational rollup (difference between commission rate of current node and subordinate nodes, applied to subordinates' totals). See `lib/settlement/calculator.ts`.

**Performance path** — Org hierarchy is snapshotted at sync time into `performance_path` JSONB column, so settlement rollup is preserved even if the org structure changes later.

**HTML scraping integration** — The TY Life external system has no clean API; contract data is extracted from HTML responses using `node-html-parser` (server-only, configured in `next.config.ts`).

## Environment Variables

| Variable | Scope | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Public | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public | Supabase anon key (RLS enforced) |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only | Admin key, bypasses RLS |
| `TYLIFE_BASE_URL` | Server-only | External TY Life base URL |
| `TYLIFE_SESSION_COOKIE` | Server-only | Session cookie from TY Life login |
| `TYLIFE_SYNC_PAGE_SIZE` | Server-only | Contracts per page (default: 50) |
| `TYLIFE_SYNC_RATE_LIMIT_MS` | Server-only | Delay between requests (default: 500ms) |
| `TYLIFE_SYNC_MAX_RETRIES` | Server-only | Retry attempts (default: 3) |
| `SYNC_API_SECRET` | Server-only | Bearer token protecting sync API routes |
| `NEXT_PUBLIC_APP_URL` | Public | App URL (default: localhost:3000) |

Copy `.env.example` to `.env.local` for local development.

## Database

Supabase PostgreSQL with 12 migration files in `supabase/migrations/`. Key tables:

- `customers` — SSN/phone stored masked
- `contracts` — Core business entities, linked to sales member and contractor
- `organization_members` / `organization_edges` — Org tree (ranks: 영업사원/리더/센터장/사업본부장/본사)
- `settlement_rules` — Commission rates by rank and effective date
- `monthly_settlements` — Calculated results (direct + rollup)
- `sync_runs` / `sync_logs` — Sync execution history and audit trail

RLS is minimal currently (service_role used for writes; anon key for reads with basic policies).

## Security Conventions

- SSN and phone numbers must always be masked before storage and display — see `src/lib/utils/mask.ts`
- `SUPABASE_SERVICE_ROLE_KEY` and `TYLIFE_SESSION_COOKIE` must never be exposed to the browser
- `SYNC_API_SECRET` must be validated as Bearer token on all `/api/sync/*` routes
- Path alias: `@/*` maps to `src/*`
