# CLAUDE.md — instructions for Claude Code

This repo is a standalone **inventory, manufacturing and sales system** for a
Kenyan business that imports boards and accessories, builds pool tables in its
workshop, and sells tables, accessories and services.

## Source of truth

Read these before changing code. If code and docs disagree, the docs win, unless
the change you are making updates the docs too.

- `docs/01-project-specification.md`: domain rules, FIFO engine, data model, API, pages
- `docs/02-development-phases.md`: the phase you are working on, with tasks and acceptance criteria
- `docs/03-decisions-log.md`: decisions and open questions with working assumptions

Work **one phase at a time**. Don't build features from later phases. Leave a
`// TODO(phase-N)` note where a later phase will plug in.

## Stack

- Monorepo with npm workspaces: `client/` (React + TS + Vite + Tailwind + React Router + TanStack Query),
  `server/` (Node + Express + TS + Mongoose), `shared/` (zod schemas + types)
- MongoDB: Atlas M0 in development; `mongodb-memory-server` **replica set** in tests
- Tests: Vitest (client), Vitest or Jest + Supertest (server)

## Non-negotiable rules (spec §3)

1. Stock balances and cost layers are **never edited directly**. Only the stock
   engine (`server/src/engine`) writes `stock_movements`, `cost_layers` and `stock_balances`.
2. Every stock posting runs inside a **MongoDB transaction** and is **idempotent**
   (`Idempotency-Key` header).
3. Valuation is **FIFO**: inbound movements create layers; outbound movements consume the oldest
   layers first and record `layersConsumed`.
4. Negative stock is rejected.
5. Money is stored as **integer cents (KES)**, never floats. Quantities are `Decimal128`;
   do the arithmetic with `decimal.js`.
6. Posted documents are immutable. Corrections go through reversing documents.
7. Every route checks a permission (`requirePermission('module.action')`). Every
   create, update, approve, post or reverse action writes an audit log entry.
8. Validate every request with zod schemas from `shared/`.
9. Never commit secrets. Keep `.env.example` up to date.

## Code conventions

- TypeScript `strict`. No `any` without a comment explaining why.
- Server module layout: `server/src/modules/<module>/{model,schema,service,controller,routes}.ts`.
  Business logic lives in `service`. Controllers stay thin.
- API: `/api/v1/...`; success `{ data, meta }`; error `{ error: { code, message, details } }`.
- Document numbers come from the `counters` service (e.g. `GRN-2026-00042`).
- Dates are stored in UTC and displayed in `Africa/Nairobi`.
- UI: navy sidebar, white cards, rounded panels, blue primary actions,
  green/orange/red status badges. It must work at tablet and phone width.

## Workflow

- Branch from `dfstock`: `phase-<n>/<short-name>`. Use small conventional commits
  (`feat(engine): ...`, `fix(sales): ...`, `docs: ...`).
- Before saying a task is done, run `npm run lint`, `npm run typecheck` and `npm test`,
  and make sure they all pass.
- The stock engine needs ≥ 90% test coverage, including concurrency tests.
- When a business rule changes, update the spec and the decisions log in the same commit.
- At the end of each phase, tick the checklist in `docs/02-development-phases.md` and
  summarise how each acceptance criterion was met.
- If a requirement is ambiguous, check the decisions log for the working assumption. If it
  isn't covered there, ask before guessing.
