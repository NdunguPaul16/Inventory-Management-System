# Development Phases

Each phase delivers working, tested software that builds on the previous one.
A phase is **done** only when its acceptance criteria pass and the code is
merged into `dfstock`.

Section references (§) point to [`01-project-specification.md`](./01-project-specification.md).

| # | Phase | Main outcome | Depends on |
|---|---|---|---|
| 0 | Project setup | Monorepo, tooling, CI, DB connection | — |
| 1 | Foundation | Auth, roles, settings, master data | 0 |
| 2 | Stock engine & inventory | FIFO ledger, opening stock, adjustments, transfers, counts | 1 |
| 3 | Purchasing & imports | PO → GRN → supplier invoice, FX, landed cost | 2 |
| 4 | Manufacturing | BOMs, production orders, finished-goods costing | 2, 3 |
| 5 | Sales | Customers, pricing, quotes, orders, delivery, invoices, PDFs | 2, 4 |
| 6 | eTIMS integration | Signed invoices & credit notes via KRA | 5 |
| 7 | Finance | Receivables, payables, payments, valuation/margin/VAT reports | 3, 5 |
| 8 | KYC & documents | Private document storage, verification, expiry alerts | 1 |
| 9 | Dashboard & analytics | KPIs, charts, alerts, exports | 2–7 |
| 10 | Hardening & go-live | Security review, backups, data migration, production deploy | all |

> Phase 8 depends only on Phase 1 and can be built in parallel with
> phases 3–7 if there is a second developer.

---

## Phase 0 — Project setup

**Goal:** an empty but production-shaped codebase that anyone can clone and run.

Tasks:
- [ ] Monorepo with npm workspaces: `client/`, `server/`, `shared/` (§2.1)
- [ ] `server`: Express + TS, `tsx`/`nodemon` dev, `pino` logging, error handler, `/api/v1/health`
- [ ] `client`: Vite + React + TS + Tailwind + React Router + TanStack Query; base layout (navy sidebar, top bar)
- [ ] `shared`: zod + shared types package
- [ ] MongoDB connection (Atlas M0 dev); `mongodb-memory-server` **replica set** for tests (transactions need one)
- [ ] ESLint, Prettier, `tsconfig` strict, husky + lint-staged
- [ ] Vitest (client), Jest/Vitest + Supertest (server)
- [ ] GitHub Actions CI: install → lint → type-check → test on every push / PR
- [ ] `.env.example`, `README` run instructions
- [ ] `counters` service for document numbering (atomic `$inc`)

**Acceptance criteria:**
- `npm install && npm run dev` starts the client and server; health check returns DB status.
- CI is green on `dfstock`.

---

## Phase 1 — Foundation

**Goal:** secure access and the master data every later module needs. (§4, §12)

Backend:
- [ ] Users, roles, permissions (seed default roles from §12)
- [ ] Login / refresh / logout / me; argon2 hashing; lockout; JWT + httpOnly refresh cookie
- [ ] RBAC middleware `requirePermission('items.create')`
- [ ] Audit log service + middleware (§17)
- [ ] Settings: company profile, logo, numbering formats, approval thresholds, base currency
- [ ] Master data CRUD: categories, units + conversions, locations, currencies and exchange rates, tax categories, payment methods, customer groups
- [ ] Items CRUD with all fields in §4.2 (incl. item type, serial tracking, KRA codes as placeholders)

Frontend:
- [ ] Login page, protected routes, permission-aware menu
- [ ] Users & roles admin, settings pages
- [ ] Master data screens; items list (search, filters, pagination) and item form

**Acceptance criteria:**
- Users without a permission get `403` from the API and don't see the menu item.
- Every create/update is visible in the audit log with the user and a diff.
- Items can be created for all six item types, with unit conversions.

---

## Phase 2 — Stock engine & inventory

**Goal:** the FIFO heart of the system. (§3, §5)

Backend:
- [ ] `engine/` service: `postIn`, `postOut`, `transfer`, `reverse`; all calls run inside Mongo transactions
- [ ] `stock_movements`, `cost_layers`, `stock_balances`, `serial_numbers` models + indexes
- [ ] Negative-stock guard; idempotency keys on posting endpoints
- [ ] **Opening stock** import (CSV/Excel → validated → posted as `OPENING` layers)
- [ ] Stock adjustments with approval workflow (§12 thresholds)
- [ ] Stock transfers between locations (FIFO layers preserved)
- [ ] Stock counts: freeze → count entry → variance review → post `COUNT_VARIANCE`
- [ ] Reconciliation job (§5.4) + admin endpoint
- [ ] Queries: balances by item/location, movement history, layer view, valuation as at date

Frontend:
- [ ] Stock balances page; item detail tabs: *Stock*, *FIFO layers*, *Movements*
- [ ] Opening stock import wizard
- [ ] Adjustment, transfer and stock count screens with approval actions

**Tests (must have):**
- [ ] FIFO consumption across multiple layers (e.g. lot A 10 @ 26,000, lot B 10 @ 28,000, issue 12 → cost 316,000)
- [ ] Insufficient stock rejected; no partial writes after abort
- [ ] Concurrent OUT postings on the same item never oversell (parallel test)
- [ ] Transfer keeps the original layer cost and date
- [ ] Reversal restores the exact prior state
- [ ] Reconciliation finds no differences after a randomized sequence of postings

**Acceptance criteria:** all engine tests pass with ≥ 90% coverage of `engine/`.

---

## Phase 3 — Purchasing & imports

**Goal:** goods come in at the correct landed KES cost. (§6, §5.3)

Backend:
- [ ] Suppliers (basic profile; KYC documents arrive in Phase 8)
- [ ] Purchase orders with approval threshold; multi-currency lines
- [ ] Import shipments (container/BL no., ETA, status, linked POs)
- [ ] GRN: receive full or partial quantities against a PO, choose location, convert at the GRN exchange rate, post → engine `IN`
- [ ] Supplier invoices with 3-way match warnings (PO vs GRN vs invoice)
- [ ] Landed cost vouchers: cost lines (freight, insurance, duty, IDF, RDL, clearing, transport…), allocation method (value / qty / weight / volume), posting → revaluation incl. already-consumed portions (§5.3)
- [ ] Purchase returns (engine `OUT`)

Frontend:
- [ ] Supplier list/detail; PO form with approval; shipment tracker
- [ ] GRN receiving screen (scan/enter quantities, partial receipt)
- [ ] Landed cost screen showing an allocation preview before posting

**Tests:** partial receipts; FX conversion; landed cost allocation by each method;
late landed cost after partial consumption updates both the remaining layers and the variance.

**Acceptance criteria:** Importing a container of boards in USD, receiving it, then
posting freight and duty afterwards gives the expected KES unit cost on the
remaining stock, and records a variance for boards already used.

---

## Phase 4 — Manufacturing (workshop)

**Goal:** know exactly what every pool table cost to build. (§7)

Backend:
- [ ] BOMs with versions, copy-to-variant, standard labour and overhead per unit
- [ ] BOM cost roll-up (current FIFO estimate)
- [ ] Production orders: release (availability check, optional reservation) → issue materials (`PRODUCTION_ISSUE`) → complete (`PRODUCTION_RECEIPT` + serial numbers) → close
- [ ] Material usage variance (actual vs BOM)
- [ ] WIP valuation; late-cost variance passed to finished goods / COGS on close
- [ ] Link production orders to sales orders (make-to-order) — the field exists now; the UI arrives in Phase 5

Frontend:
- [ ] BOM editor with live cost preview
- [ ] Production orders Kanban (Released / In progress / Completed)
- [ ] Tablet-friendly material issue and completion screens (serial capture)
- [ ] Production cost report: planned vs actual per order and per model

**Tests:** finished table cost = Σ FIFO materials + labour + overhead; partial
completion; cancelling before issue; serial numbers are unique.

**Acceptance criteria:** Building one 8ft table from the sample BOM in the specification
creates a finished-good layer at the expected cost, and component stock decreases correctly.

---

## Phase 5 — Sales

**Goal:** sell tables, accessories and services at the right price, with correct COGS. (§8)

Backend:
- [ ] Customers (profile, group, credit limit, terms, KRA PIN)
- [ ] Price lists per customer group; customer-specific prices; price resolution endpoint
- [ ] Margin floor and price override permissions/approvals
- [ ] Quotations → sales orders (deposits recorded as advances) → production order (make-to-order)
- [ ] Delivery notes → engine `OUT` (FIFO COGS, serials)
- [ ] Invoices (status `PENDING_TAX` until Phase 6; `MOCK` adapter signs in development)
- [ ] Cash sale (one-step) for accessories
- [ ] Credit notes and sales returns (`SALE_RETURN` at original cost)
- [ ] PDF invoice generation (§8.4), with placeholders for eTIMS fields

Frontend:
- [ ] Customer screens; price list editor
- [ ] Quote and order forms with live price, cost and margin indicator (cost visible only with permission)
- [ ] Cash sale / POS screen
- [ ] Invoice view and PDF download; credit note flow

**Tests:** price resolution order; below-cost blocked without approval; delivery
COGS matches the FIFO layers; return re-enters at the original cost; credit note reverses correctly.

**Acceptance criteria:** One table is sold to a pool hall and one to a retail customer at different
prices. The margin report shows each sale's margin from the same FIFO cost.

---

## Phase 6 — KRA eTIMS integration

**Goal:** every invoice and credit note is tax-compliant. (§9)

- [ ] Confirm the integration path (OSCU/VSCU, direct vs third-party) and obtain sandbox credentials
- [ ] Implement the `TaxAuthorityAdapter` for the sandbox
- [ ] Sync KRA lookup codes (item classes, tax types, units); map items and tax categories
- [ ] Item registration
- [ ] Submit invoices and credit notes; store signature, control number and QR data
- [ ] `etims_queue` with retries/backoff; failure alerts; manual retry screen
- [ ] PDF shows the eTIMS fields and QR code
- [ ] (If required) submit purchases, imports and stock movements

**Acceptance criteria:** Invoices are signed in the sandbox end-to-end. A simulated KRA
outage queues the submissions, which recover automatically. No PDF is final without a signature.

---

## Phase 7 — Finance

**Goal:** run the money side without an external accounting package. (§11)

- [ ] Receipts (cash, M-Pesa, bank, cheque) and allocation to invoices / deposits
- [ ] Supplier payments (multi-currency) and FX gain/loss
- [ ] Customer and supplier statements; ageing reports
- [ ] Inventory valuation by type/location/as-at date
- [ ] Margin reports by item, model, customer, group, period
- [ ] VAT report (output vs input)
- [ ] `financial_events` written by every financial document (GL-ready)
- [ ] Excel/CSV export for every report

**Acceptance criteria:** Valuation at month end equals Σ remaining layers. AR and AP
ageing match the open documents. The accountant can export everything.

---

## Phase 8 — KYC & documents

**Goal:** secure customer/supplier compliance documents. (§10)

- [ ] Storage adapter (local in development, private object storage in production) with signed URLs
- [ ] Upload, type, expiry and verification workflow per party
- [ ] Expiry alerts; audited downloads; retention settings
- [ ] Import documents (BL, invoices, customs entries) attached to shipments and GRNs

**Acceptance criteria:** Files are never publicly reachable. Every download is in
the audit log. Expired documents are flagged on the dashboard.

---

## Phase 9 — Dashboard & analytics

**Goal:** operational and financial visibility at a glance. (§16)

- [ ] KPI endpoints with date range filters (cached aggregates)
- [ ] Charts listed in §16 (Recharts or similar)
- [ ] Alerts: low stock, slow-moving, eTIMS failures, overdue invoices, expiring KYC
- [ ] Analytics backlog: demand forecasting, data-driven reorder points (lead-time variability), ABC classification, customer-group price analysis

**Acceptance criteria:** Dashboard numbers reconcile with the detailed reports for the
same period.

---

## Phase 10 — Hardening & go-live

- [ ] Security review (OWASP top 10, dependency audit, RBAC matrix test)
- [ ] Load test of the posting endpoints
- [ ] Automated backups + **tested restore**
- [ ] Choose production hosting and a paid MongoDB tier; staging environment
- [ ] Data migration: items, opening stock (with FIFO layers), customers, suppliers, open documents
- [ ] User training and a parallel run with the current process for one stock cycle
- [ ] Go-live checklist and rollback plan

---

## Working agreements

- **Branching:** feature branches from `dfstock` named `phase-<n>/<short-name>`
  (e.g. `phase-2/fifo-engine`), merged by pull request with green CI.
- **Commits:** small, descriptive (`feat(engine): consume FIFO layers on OUT`).
- **Definition of done:** code + tests + updated docs + demo of the acceptance criteria.
- **Docs first for rule changes:** if a business rule changes, update the specification
  and the decisions log in the same PR.
