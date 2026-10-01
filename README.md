# Inventory Management System

A standalone inventory, manufacturing and sales system for an import business
that **imports boards and accessories, builds pool tables in its workshop, and
sells** tables, accessories and services to a wide customer base.

## Key capabilities

- **One stock ledger, FIFO valuation**, including landed cost and foreign-currency imports
- **Purchasing & imports**: purchase orders → shipments → goods received notes → supplier invoices → landed costs
- **Workshop manufacturing**: bills of materials, production orders, and an accurate cost for every table
- **Sales**: customer-group pricing, quotes, orders, deliveries, PDF invoices and credit notes
- **KRA eTIMS** integration for tax invoices
- **Finance**: receivables, payables, valuation, margin and VAT reports, with no QuickBooks dependency
- **KYC documents**, role-based access, a full audit trail, and a management dashboard

## Tech stack

React + TypeScript · Node.js + Express + TypeScript · MongoDB (Atlas M0 in development)

## Running locally

**Prerequisites:** Node.js 22.12+ (see `.nvmrc`) and npm 10+. A MongoDB is optional
in development: see step 2.

```bash
npm install          # installs all workspaces; also downloads a test mongod binary (~100 MB, once)
cp .env.example .env # optional; edit as needed
npm run dev          # client on http://localhost:5173, API on http://localhost:4000/api/v1
```

1. **Open the app** at <http://localhost:5173>. The *System status* page (bottom of the
   sidebar) calls `GET /api/v1/health` and shows the API and MongoDB status.
2. **Database.** Set `MONGODB_URI` in `.env` to your Atlas M0 connection string. If you
   leave it empty, the dev server starts a throwaway **in-memory replica set** and
   warns you that data won't persist. It must be a replica set either way, because stock
   postings run inside transactions.
3. The Vite dev server proxies `/api` to the API, so the browser only talks to one origin.

### Scripts (repo root)

| Script | What it does |
|---|---|
| `npm run dev` | Builds `shared`, then runs `shared` (watch), `server` (tsx watch) and `client` (Vite) together |
| `npm run build` | Production build of `shared`, `server` (`server/dist`) and `client` (`client/dist`) |
| `npm run lint` | ESLint across the repo (zero warnings allowed) |
| `npm run format` / `format:check` | Prettier (Markdown docs are excluded) |
| `npm run typecheck` | `tsc --noEmit` in every workspace |
| `npm test` | Vitest in every workspace. Server tests use `mongodb-memory-server` in replica-set mode |

A husky pre-commit hook runs lint-staged (ESLint + Prettier on staged files). CI
(GitHub Actions) runs install → lint → format check → typecheck → test → build on every
push and pull request.

### Layout

```text
client/   React + Vite + Tailwind + React Router + TanStack Query
server/   Express + Mongoose API (src/config, middleware, modules/<module>, engine, integrations, jobs)
shared/   zod schemas and types used by both (@ims/shared)
docs/     specification, phases, decisions
```

## Documentation

| Document | Purpose |
|---|---|
| [Project specification](docs/01-project-specification.md) | Master blueprint: domain rules, FIFO engine, modules, data model, API, pages |
| [Development phases](docs/02-development-phases.md) | Phase-by-phase build plan with tasks and acceptance criteria |
| [Decisions log](docs/03-decisions-log.md) | Decided items and open questions with working assumptions |
| [Claude Code prompts](docs/04-claude-code-prompts.md) | Ready-to-paste prompts for building each phase with Claude Code |

## Status

✅ Phase 0 (project setup) complete. **Next: Phase 1 (foundation).**
