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
npm run dev          # frontend on http://localhost:5173, API on http://localhost:4000/api/v1
```

1. **Database.** Set `MONGODB_URI` in `.env` to your Atlas M0 connection string. If you
   leave it empty, the dev server starts a throwaway **in-memory replica set** and
   warns you that data won't persist. It must be a replica set either way, because stock
   postings run inside transactions.
2. **Create a local administrator** with `npm run build:shared`,
   `npm run build -w backend`, then `npm run bootstrap:admin -w backend`. The CLI
   prompts for the name and email and reads the password without echoing it. It refuses to
   run if any users already exist. Open <http://localhost:5173>, sign in, and use the
   *System status* page at the bottom of the sidebar to view API and MongoDB status.
3. The Vite dev server proxies `/api` to the API, so the browser only talks to one origin.
   The frontend keeps access tokens in memory and uses the backend's HttpOnly refresh cookie.

### Scripts (repo root)

| Script | What it does |
|---|---|
| `npm run dev` | Builds `shared`, then runs `shared` (watch), `backend` (tsx watch) and `frontend` (Vite) together |
| `npm run build` | Production build of `shared`, `backend` (`backend/dist`) and `frontend` (`frontend/dist`) |
| `npm run lint` | ESLint across the repo (zero warnings allowed) |
| `npm run format` / `format:check` | Prettier (Markdown docs are excluded) |
| `npm run typecheck` | `tsc --noEmit` in every workspace |
| `npm test` | Vitest in every workspace. Backend tests use `mongodb-memory-server` in replica-set mode |

A husky pre-commit hook runs lint-staged (ESLint + Prettier on staged files). CI
(GitHub Actions) runs install → lint → format check → typecheck → test → build on every
push and pull request.

### Layout

```text
frontend/ React + Vite + Tailwind + React Router + TanStack Query (src/modules/<domain>)
backend/  Express + Mongoose API (src/modules/<domain>; inventory/engine owns the FIFO ledger)
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
| [Deployment setup](docs/deployment.md) | Vercel frontend and Render backend configuration and required environment variables |

## Status

The Phase 0 scaffold, priority fixes, frontend/backend refactor, Phase 1A login
and protected navigation, and Phase 1B users and roles administration are on
`dfstock`. Settings and master data, the opening-stock import wizard, stock
counts, and frontend inventory screens remain outstanding.

### Controlled stock changes

Opening stock, adjustments and reversals use an audited request → approval →
posting flow. `POST /api/v1/inventory/opening-stock`, `/adjustments`, or
`/movements/:movementId/reverse` creates a pending request without moving stock.
Authorised users review it through `GET /api/v1/inventory/requests`, then use
`POST /api/v1/inventory/requests/:requestId/approve` or `/reject`. The approver
posts an approved request with `POST /api/v1/inventory/requests/:requestId/post`.
The request status, ledger movements and audit records commit in one MongoDB
transaction. Existing `audit_log` records are moved to `audit_logs` at startup.
