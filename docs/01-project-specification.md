# Project Specification — Inventory, Manufacturing & Sales System

> Master blueprint for building the system. Every coding phase in
> [`02-development-phases.md`](./02-development-phases.md) refers back to the
> sections here. Open questions and assumptions live in
> [`03-decisions-log.md`](./03-decisions-log.md).

**Version:** 0.1 (draft for development)  
**Stack:** React + TypeScript · Node.js + Express + TypeScript · MongoDB (Atlas M0 in development)  
**Branch:** `dfstock`

---

## 1. Business context

The company **imports boards and accessories**, builds **pool tables in its own
workshop**, and **sells** both finished tables and accessories to a wide
customer base (pool halls, bars, clubs, dealers, homes and corporate buyers).

| Activity | What happens to stock | Financial meaning |
|---|---|---|
| Import / purchase | Boards, cloth, rubber, pockets, accessories come in | Stock value increases at **landed cost** |
| Workshop production | Components are issued into a production order; a finished pool table comes out | Cost **moves** from raw materials → work in progress → finished goods (not an expense) |
| Sale | Finished tables, accessories, or services go out to customers | Revenue recorded; **FIFO cost of goods sold** recorded |
| Return / adjustment / count | Controlled corrections | Approved, traceable value changes |

The system is **standalone**. It doesn't depend on QuickBooks, Xero or Sage. It
must produce its own financial reports and exports, and integrate with **KRA
eTIMS** for tax invoices.

### 1.1 Goals

1. One accurate stock position per item and location, derived from a single
   **stock ledger**.
2. Correct **FIFO** valuation, including **landed cost** and **foreign
   currency** imports.
3. Accurate **cost of every pool table built** (components + labour +
   overhead).
4. Flexible **selling prices per customer group**, with margin protection.
5. **eTIMS-compliant** invoices and credit notes.
6. Receivables, payables and management reporting without an external
   accounting package.
7. Full **audit trail**: every change has a user, a time and a reference
   document.

### 1.2 Out of scope for v1

- Full general ledger / double-entry accounting (the data model leaves room for it, see §11).
- Payroll.
- E-commerce storefront.
- Mobile native apps (the web app must be responsive).

---

## 2. Architecture

```
┌────────────────────┐   HTTPS/JSON   ┌─────────────────────────────┐
│ React + TS (Vite)  │ ─────────────▶ │ Express + TS REST API       │
│ Tailwind, charts   │                │  ├─ auth / RBAC middleware  │
└────────────────────┘                │  ├─ modules (domain logic)  │
                                      │  ├─ stock engine (FIFO)     │
                                      │  ├─ eTIMS adapter + queue   │
                                      │  └─ PDF service             │
                                      └──────────┬──────────────────┘
                                                 │ Mongoose (transactions)
                                    ┌────────────▼────────────┐   ┌──────────────────┐
                                    │ MongoDB (Atlas M0 dev)  │   │ Private file     │
                                    │ business data + metadata│   │ storage (KYC,    │
                                    └─────────────────────────┘   │ import docs)     │
                                                                  └──────────────────┘
```

### 2.1 Repository layout (monorepo)

```
/
├── client/                 React app (Vite + TS + Tailwind)
│   └── src/
│       ├── app/            routing, layout, auth context
│       ├── features/       one folder per module (items, purchasing, ...)
│       ├── components/     shared UI (tables, forms, KPI cards)
│       └── lib/            api client, formatters, hooks
├── server/                 Express API
│   └── src/
│       ├── config/         env, db connection
│       ├── middleware/     auth, rbac, validation, error handler
│       ├── modules/        <module>/{model,service,controller,routes,schema}.ts
│       ├── engine/         stock ledger + FIFO engine (pure, heavily tested)
│       ├── integrations/   etims/, storage/, pdf/
│       └── jobs/           reconciliation, eTIMS retry queue, backups
├── shared/                 shared TS types & zod schemas (client + server)
└── docs/                   this documentation
```

### 2.2 Technical conventions

| Concern | Decision |
|---|---|
| Language | TypeScript everywhere, `strict: true` |
| Validation | `zod` schemas in `shared/`, used by both client forms and API |
| ODM | Mongoose, with **multi-document transactions** for every stock-affecting operation |
| Money | Stored as **integers in cents** (KSh × 100). Never floats. |
| Foreign money | Amount in cents + currency code + exchange rate (stored with 6 dp as a string/Decimal128) |
| Quantity | `Decimal128` in the item's **base unit**, arithmetic via `decimal.js` |
| Dates | Stored UTC; displayed in `Africa/Nairobi` |
| IDs | MongoDB ObjectId internally; human document numbers from a `counters` collection (e.g. `GRN-2026-00042`) |
| API style | REST, JSON, `/api/v1/...`, consistent envelope `{ data, meta }` / `{ error: { code, message, details } }` |
| Auth | JWT access token (15 min) + httpOnly refresh cookie (7 days), bcrypt/argon2 password hashing |
| Testing | Vitest/Jest unit tests (engine ≥ 90% coverage), Supertest API tests against `mongodb-memory-server` replica set |
| Lint/format | ESLint + Prettier, enforced in CI (GitHub Actions) |

---

## 3. Core domain rules

These rules are **non-negotiable invariants**. The code enforces them on the
server, never the client.

1. **One inventory, one ledger.** Stock balances are never edited directly.
   Every change is a `stock_movement` created by an approved business document.
2. **Every movement has a reference.** It records the source document type and id,
   the user, the time, the location and the reason.
3. **Valuation is FIFO.** Every inbound movement creates a **cost layer**.
   Every outbound movement consumes the oldest layers first and records which
   layers it consumed.
4. **No negative stock.** An outbound movement that would take an item and location
   below zero is rejected (configurable per item later, off by default).
5. **POs don't move stock; GRNs do.**
6. **Production isn't an expense.** Issuing components to a production order
   moves value into WIP (work in progress); completing the order moves value
   into finished goods.
7. **Cost ≠ price.** Cost comes from FIFO. Price comes from price lists
   or quotes, and can vary by customer.
8. **Issued documents are immutable.** You never edit an issued invoice, GRN or
   completed production order. You correct it with a reversing document
   (credit note, return, adjustment, reversal).
9. **Everything important is audited** (create, update, approve, post, cancel,
   reverse, login, permission change).

---

## 4. Master data

### 4.1 Item types

| Type | Example | Stocked? | Has BOM? | Sold? |
|---|---|---|---|---|
| `RAW_MATERIAL` | Boards / slate beds, timber, cushion rubber | Yes | No | Rarely |
| `COMPONENT` | Pockets, cloth rolls, leg sets, bolts | Yes | No | Sometimes |
| `FINISHED_GOOD` | 7ft / 8ft / 9ft pool tables | Yes | **Yes** | Yes |
| `TRADING_GOOD` | Cues, balls, chalk, covers, racks (bought and resold as-is) | Yes | No | Yes |
| `CONSUMABLE` | Glue, screws, sandpaper | Yes (optional) | No | No (absorbed into overhead) |
| `SERVICE` | Installation, delivery, re-clothing | **No** | No | Yes |

### 4.2 Item master fields

- `sku`, `name`, `description`, `type`, `categoryId`
- `baseUnit` (e.g. `PCS`, `M`, `KG`), plus `unitConversions[]`
  (e.g. 1 `ROLL` = 25 `M`, 1 `SET` = 3 `PCS`)
- `trackSerial` (true for finished tables), `trackBatch` (optional for boards)
- `reorderLevel`, `reorderQty`, `leadTimeDays` (per item, optional per supplier)
- `defaultSalesPrice` (cents), `taxCategory`, `kraItemClassCode`,
  `kraPackagingUnit`, `kraQuantityUnit` (for eTIMS)
- `variantAttributes` for finished goods (size, cloth colour, finish)
- `isActive`, audit fields

### 4.3 Other master data

- **Categories**: hierarchical (`parentId`).
- **Locations / warehouses**: `code`, `name`, `type` (`WAREHOUSE`, `WORKSHOP`,
  `SHOWROOM`, `IN_TRANSIT`). Multi-location is supported from day one.
- **Currencies & exchange rates**: KES base; daily or manual rates.
- **Customer groups** (`RETAIL`, `POOL_HALL`, `DEALER`, `CORPORATE`, …) and
  **price lists**.
- **Tax categories** mapped to eTIMS tax types (confirm the codes against the KRA spec).
- **Payment methods**: cash, M-Pesa, bank transfer, cheque, card.

---

## 5. Stock engine (FIFO)

The stock engine is a **pure service** (`server/src/engine`) that every module
calls. No module writes `stock_movements` or `cost_layers` directly.

### 5.1 Collections

**`stock_movements`** (append-only ledger)

```ts
{
  _id, movementNo,
  itemId, locationId,
  direction: 'IN' | 'OUT',
  quantity: Decimal128,           // always positive, base unit
  movementType: 'OPENING' | 'GRN' | 'PRODUCTION_ISSUE' | 'PRODUCTION_RECEIPT'
              | 'SALE' | 'SALE_RETURN' | 'PURCHASE_RETURN'
              | 'ADJUSTMENT_IN' | 'ADJUSTMENT_OUT'
              | 'TRANSFER_IN' | 'TRANSFER_OUT' | 'COUNT_VARIANCE',
  unitCost: number,               // cents, weighted across layers consumed
  totalCost: number,              // cents
  layersConsumed?: [{ layerId, quantity, unitCost }],  // OUT only
  layerCreated?: ObjectId,        // IN only
  sourceDoc: { type, id, number, lineId },
  serialNumbers?: string[],
  reversalOf?: ObjectId,
  postedAt, postedBy
}
```

**`cost_layers`**

```ts
{
  _id, itemId, locationId,
  sourceDoc: { type, id, number },
  receivedAt,                     // FIFO ordering key
  originalQty: Decimal128,
  remainingQty: Decimal128,
  unitCost: number,               // cents, KES, includes allocated landed cost
  costHistory: [{ at, oldUnitCost, newUnitCost, reason, docRef }],
  currency?: { code, foreignUnitCost, rate }   // trace of import origin
}
```

**`stock_balances`** (cache, rebuilt from the ledger at any time)

```ts
{ itemId, locationId, onHand: Decimal128, reserved: Decimal128,
  value: number /* cents */, lastMovementAt }
```

### 5.2 Posting algorithm

```
postMovement(input):
  start session + transaction
    lock: findOneAndUpdate stock_balances {itemId, locationId} (bump version)
    if IN:
       create cost_layer(remainingQty = qty, unitCost = input.unitCost)
       write stock_movement(direction IN, layerCreated)
    if OUT:
       layers = cost_layers where remainingQty > 0
                order by receivedAt asc, _id asc
       consume oldest first until qty satisfied
       if not satisfied → abort (INSUFFICIENT_STOCK)
       write stock_movement(direction OUT, layersConsumed, totalCost)
    update stock_balances (onHand, value)
    write audit_log
  commit
```

- **Transfers** consume layers at the source and recreate them at the destination,
  keeping the original `receivedAt` and `unitCost`, so FIFO order is preserved.
- **Returns from customers** re-enter at the cost they left with (taken from the
  original sale movement's `layersConsumed`).
- **Reversals** post the exact opposite movement and link `reversalOf`.

### 5.3 Late landed cost (revaluation)

When a landed-cost document is posted after the goods were received:

1. Allocate the cost to the GRN lines (by value, quantity, weight or volume, chosen per landed-cost doc).
2. For each affected layer:
   - portion still in `remainingQty` → increase the layer's `unitCost` (logged in `costHistory`);
   - portion already consumed → post a **cost variance** record against the
     consuming documents (production order → finished good layer, or sale → COGS).
3. Every revaluation is auditable and reversible.

### 5.4 Reconciliation job

A nightly job (and an admin button) recomputes `onHand` and `value` per item and location
from `stock_movements` and `cost_layers`, and flags any difference from
`stock_balances`.

---

## 6. Purchasing & imports

### 6.1 Flow

```
Supplier → Purchase Order (approved) → Import Shipment (optional)
        → Goods Received Note (posts stock IN, creates layers)
        → Supplier Invoice (3-way match PO/GRN/Invoice)
        → Landed Cost Voucher(s) (freight, duty, IDF, RDL, clearing, insurance...)
        → Supplier Payment
```

### 6.2 Documents

| Document | Status flow | Stock effect |
|---|---|---|
| Purchase Order | `DRAFT → PENDING_APPROVAL → APPROVED → PARTIALLY_RECEIVED → RECEIVED / CLOSED / CANCELLED` | None |
| Import Shipment | `PLANNED → IN_TRANSIT → AT_PORT → CLEARED → RECEIVED` | None (optional `IN_TRANSIT` location later) |
| GRN | `DRAFT → POSTED` (reversal only) | IN, creates cost layers |
| Supplier Invoice | `DRAFT → POSTED → PARTIALLY_PAID → PAID` | None (may adjust cost if the price differs from the PO, as a revaluation) |
| Landed Cost Voucher | `DRAFT → POSTED` | Revalues layers (§5.3) |
| Purchase Return | `DRAFT → POSTED` | OUT |

### 6.3 Foreign currency

- PO and supplier invoice can be in USD, CNY, EUR and so on.
- The GRN converts to KES at the **GRN exchange rate**. The layer cost is in KES.
- The difference between the GRN rate and the payment rate is recorded as an **FX
  gain/loss** in finance (not in stock value).

---

## 7. Manufacturing (workshop)

### 7.1 Bill of Materials (BOM)

```ts
bom: {
  bomNo, finishedItemId, version, isDefault, status: 'DRAFT'|'ACTIVE'|'ARCHIVED',
  outputQty: 1,
  lines: [{ itemId, quantity, unit, scrapPct? }],
  labourCost: number,      // standard cost per unit (cents) — see decisions log
  overheadCost: number,    // standard cost per unit (cents)
  notes
}
```

Variants (7ft/8ft/9ft, cloth colour, finish) are separate finished-good SKUs,
each with its own BOM. A BOM can be **copied** to create a new variant quickly.

### 7.2 Production Order

Status: `DRAFT → RELEASED → IN_PROGRESS → COMPLETED → CLOSED` (or `CANCELLED`
before any issue).

1. **Release:** quantities are planned from the BOM; component availability is checked
   and optionally reserved.
2. **Issue materials:** `PRODUCTION_ISSUE` movements (OUT, FIFO) from the
   workshop location. Actual quantities may differ from the BOM, and the variance is recorded.
3. **Complete:** `PRODUCTION_RECEIPT` movement (IN) of finished tables, with
   serial numbers.
   `unit cost = (Σ FIFO cost of issued materials + labour + overhead) / qty completed`
4. **Close:** locks the order. Late landed-cost variances on its materials are
   pushed to the finished-good layer (or to COGS if the table has already been sold).

A production order can be linked to a **sales order** (make-to-order) or have none
(make-to-stock).

### 7.3 Workshop reports

- Cost per table (planned vs actual), material usage variance, WIP value,
  tables completed per period, and component consumption trends.

---

## 8. Sales

### 8.1 Flow

```
Customer → Quotation → Sales Order (deposit optional)
        → [Production Order if make-to-order]
        → Delivery Note (posts stock OUT, FIFO COGS)
        → Tax Invoice (eTIMS signed) → Payments / Receipts
        → Credit Note / Sales Return (if needed)
```

For **counter sales** (accessories), a single "Cash Sale" screen creates the
sales order, delivery and invoice in one step.

### 8.2 Pricing

- Price is resolved in this order: **quote line price → customer-specific price →
  customer group price list → item default price**.
- A user can override a price only with the `sales.price.override` permission and must give a reason.
- **Margin floor:** if `price < FIFO estimated cost × (1 + minMarginPct)`, the system
  warns; below cost requires `sales.price.belowCost` approval.
- Discounts: per line (% or amount) and per document, with a permission ceiling per role.
- All price decisions are stored, which builds a **price history** for analysis.

### 8.3 Documents

| Document | Status flow | Stock effect |
|---|---|---|
| Quotation | `DRAFT → SENT → ACCEPTED / REJECTED / EXPIRED` | None |
| Sales Order | `DRAFT → CONFIRMED → IN_PRODUCTION → READY → PARTIALLY_DELIVERED → DELIVERED → CLOSED` | Reservation only |
| Delivery Note | `DRAFT → POSTED` | OUT (FIFO), serials captured |
| Invoice | `DRAFT → ISSUED (eTIMS) → PARTIALLY_PAID → PAID` / `CANCELLED via credit note` | None |
| Credit Note | `DRAFT → ISSUED (eTIMS)` | IN if goods returned (`SALE_RETURN`) |
| Receipt / Payment | `POSTED` / `REVERSED` | None |

### 8.4 PDF invoice contents

Company logo, name, address, KRA PIN · invoice number, date, due date ·
customer name, address, KRA PIN · lines (code, description, qty, unit price,
discount, tax category, line total) · subtotal, VAT breakdown by tax type,
total · amount paid / balance · payment terms and bank / M-Pesa details ·
**eTIMS fields: control unit invoice number, signature, QR code, date/time**.
The PDF is generated server-side (`pdfmake` or `@react-pdf/renderer`) and only after
eTIMS signing succeeds.

---

## 9. KRA eTIMS integration

Built as an **adapter** in `server/src/integrations/etims`, behind an interface,
so the business modules never call KRA directly.

```ts
interface TaxAuthorityAdapter {
  registerItem(item): Promise<Result>
  submitSale(invoice): Promise<SignedInvoiceResult>   // control no., signature, QR data
  submitCreditNote(note): Promise<SignedInvoiceResult>
  submitPurchase?(supplierInvoice): Promise<Result>
  submitImport?(importDoc): Promise<Result>
  submitStockMovement?(movement): Promise<Result>
}
```

- **Modes:** `MOCK` (development), `SANDBOX`, `PRODUCTION`, set by env config.
- **Queue:** submissions go into an `etims_queue` collection with retries and
  exponential backoff. An invoice stays `PENDING_TAX` until it is signed. Failures are shown on the dashboard.
- **Master data:** item classification codes, tax types, and units as required by
  KRA. They are synced into lookup collections.
- **Integration path:** OSCU (online) vs VSCU (virtual), and whether to go direct or through an
  accredited third-party integrator. Confirm with KRA before Phase 6 (see decisions log).
- Store raw request and response payloads for audit (with secrets redacted).

---

## 10. Customers, suppliers & KYC

- Profile: legal name, trading name, KRA PIN (validated format), contacts,
  billing/shipping addresses, payment terms, credit limit, customer group,
  currency (suppliers).
- **KYC documents** (`party_documents`): type (registration certificate, KRA PIN
  certificate, ID, import licence…), file reference (not the file itself),
  issue/expiry date, verification status (`PENDING / VERIFIED / REJECTED /
  EXPIRED`), verifiedBy/at.
- Files live in **private storage** (local folder in development; private object storage
  such as S3, R2 or Backblaze in production). Downloads use short-lived signed URLs and are
  audited.
- Must comply with the **Kenya Data Protection Act 2019**: purpose limitation, a
  retention policy, and access restricted by role.

---

## 11. Finance (standalone, v1)

- **Accounts receivable:** invoices, deposits/advances, receipts (cash, M-Pesa,
  bank), allocation of receipts to invoices, customer statements, ageing
  (0–30, 31–60, 61–90, 90+).
- **Accounts payable:** supplier invoices, payments in any currency, FX gain/loss,
  supplier statements, ageing.
- **Inventory valuation:** by item type (raw, components, WIP, finished,
  trading), by location, as at any date (rebuilt from the ledger).
- **Profitability:** COGS and gross margin by item, table model, customer,
  customer group, period.
- **VAT reports:** output VAT (sales) and input VAT (purchases) per period.
- **Exports:** every report downloads as Excel/CSV for the accountant.
- **Future-proofing:** every financial event stores enough detail
  (`financial_events`: type, amount, currency, doc ref, suggested account) to
  add a double-entry general ledger later without rework.

---

## 12. Users, roles & permissions

Permissions are fine-grained strings (`module.action`). Roles bundle them, and
admins can create custom roles.

| Role | Typical permissions |
|---|---|
| **Admin** | Everything, users, roles, settings |
| **Owner / Manager** | All read; approve POs, adjustments, price overrides, below-cost sales; reports |
| **Purchasing Officer** | Suppliers, POs, shipments, supplier invoices, landed cost |
| **Storekeeper** | GRNs, transfers, stock counts, delivery notes, view stock |
| **Workshop Supervisor** | BOMs (view/edit), production orders, issue materials, complete production |
| **Sales Officer** | Customers, quotes, sales orders, invoices (create), receipts; no below-cost sales |
| **Accountant** | Receivables, payables, payments, valuation, VAT and margin reports, exports |
| **Viewer / Auditor** | Read-only + audit log |

**Approval rules** (configurable in settings):

- PO above amount X → Manager approval.
- Any stock adjustment / count variance above value Y → Manager approval.
- Price override beyond Z% discount or below cost → Manager approval.
- Invoice cancellation (credit note) → Manager approval.

---

## 13. Collections (MongoDB)

| Group | Collections |
|---|---|
| Identity | `users`, `roles`, `sessions` (refresh tokens), `audit_logs` |
| Settings | `settings`, `counters`, `currencies`, `exchange_rates`, `tax_categories`, `payment_methods` |
| Master data | `items`, `categories`, `units`, `locations`, `customer_groups`, `price_lists` |
| Parties | `suppliers`, `customers`, `party_documents` |
| Stock engine | `stock_movements`, `cost_layers`, `stock_balances`, `serial_numbers` |
| Stock docs | `stock_adjustments`, `stock_transfers`, `stock_counts` |
| Purchasing | `purchase_orders`, `import_shipments`, `goods_received_notes`, `supplier_invoices`, `landed_cost_vouchers`, `purchase_returns` |
| Manufacturing | `boms`, `production_orders` |
| Sales | `quotations`, `sales_orders`, `delivery_notes`, `invoices`, `credit_notes` |
| Finance | `receipts`, `supplier_payments`, `payment_allocations`, `financial_events` |
| Integrations | `etims_queue`, `etims_lookups` |

**Modelling notes:**

- Document line items are **embedded** in their parent document (e.g. `invoice.lines[]`),
  not stored in separate collections.
- Every document has `createdAt/By`, `updatedAt/By`, `status`, and a
  `statusHistory[]`.
- Key indexes: `stock_movements {itemId, locationId, postedAt}`,
  `cost_layers {itemId, locationId, remainingQty, receivedAt}`, unique
  `{docNumber}` per document collection, `customers {kraPin}`.

**Capacity note:** Atlas M0 (512 MB, no automated backups) is for development
only. Schedule `mongodump` backups from day one, and plan the paid tier before go-live.

---

## 14. API overview (`/api/v1`)

| Area | Endpoints (representative) |
|---|---|
| Auth | `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `GET /auth/me` |
| Users/roles | `GET/POST /users`, `PATCH /users/:id`, `GET/POST /roles` |
| Items | `GET/POST /items`, `GET/PATCH /items/:id`, `GET /items/:id/stock`, `GET /items/:id/movements` |
| Stock | `GET /stock/balances`, `GET /stock/movements`, `POST /stock/adjustments`, `POST /stock/adjustments/:id/approve`, `POST /stock/transfers`, `POST /stock/counts`, `POST /stock/counts/:id/post` |
| Purchasing | `/purchase-orders`, `/purchase-orders/:id/approve`, `/import-shipments`, `/grns`, `/grns/:id/post`, `/supplier-invoices`, `/landed-costs`, `/landed-costs/:id/post`, `/purchase-returns` |
| Manufacturing | `/boms`, `/boms/:id/copy`, `/production-orders`, `/production-orders/:id/release`, `/:id/issue`, `/:id/complete`, `/:id/close` |
| Sales | `/quotations`, `/quotations/:id/convert`, `/sales-orders`, `/delivery-notes`, `/delivery-notes/:id/post`, `/invoices`, `/invoices/:id/issue`, `/invoices/:id/pdf`, `/credit-notes`, `/cash-sales` |
| Pricing | `/price-lists`, `GET /pricing/resolve?itemId&customerId&qty` |
| Finance | `/receipts`, `/supplier-payments`, `/allocations`, `GET /customers/:id/statement`, `GET /suppliers/:id/statement` |
| Parties | `/customers`, `/suppliers`, `/parties/:id/documents` (upload → signed URL) |
| Reports | `/reports/valuation`, `/reports/movements`, `/reports/sales`, `/reports/margins`, `/reports/production-cost`, `/reports/ageing`, `/reports/vat`, `?format=xlsx` |
| Dashboard | `GET /dashboard/kpis?from&to`, `GET /dashboard/charts/:name` |
| eTIMS | `GET /etims/queue`, `POST /etims/queue/:id/retry`, `POST /etims/sync-lookups` |
| Audit | `GET /audit-logs?entity&user&from&to` |

---

## 15. Frontend pages

Layout: navy sidebar navigation, white cards, rounded panels, blue primary
actions, green/orange/red status badges, and responsive design down to tablet and phone width.

| Section | Pages |
|---|---|
| Dashboard | KPIs, charts, alerts (low stock, eTIMS failures, expiring KYC, overdue invoices) |
| Inventory | Items list/detail (stock per location, FIFO layers, movement history), categories, locations, adjustments, transfers, stock counts |
| Purchasing | Suppliers, POs, import shipments, GRNs, supplier invoices, landed costs, purchase returns |
| Workshop | BOMs (with cost roll-up preview), production orders (Kanban by status), material issue screen, completion with serial capture |
| Sales | Customers, quotations, sales orders, cash sale/POS screen, delivery notes, invoices (PDF), credit notes, price lists |
| Finance | Receipts, supplier payments, statements, ageing |
| Reports | Valuation, movements, sales, margins, production cost, VAT, exports |
| Settings | Company profile, users and roles, approval thresholds, numbering, taxes, currencies, eTIMS config |
| Audit | Searchable audit log |

---

## 16. Dashboard KPIs

| KPI | Definition |
|---|---|
| Inventory value | Σ remaining layer value, split by raw / components / WIP / finished / trading |
| Sales | Invoiced value (ex-VAT) in period |
| Gross margin | (Sales − FIFO COGS) / Sales, by period, model, customer group |
| Tables produced | Production receipts in period; average cost per model |
| WIP value | Issued-but-not-completed production cost |
| Incoming | Open PO value and shipments in transit, with ETA |
| Low stock | Items at or below reorder level (or projected stockout within lead time) |
| Slow-moving | Items with no OUT movement in N days (configurable, default 90) |
| Inventory turnover / days of inventory | COGS ÷ average inventory; 365 ÷ turnover |
| Receivables | Outstanding and overdue amounts |
| eTIMS health | Pending / failed submissions |

**Charts:** inbound vs production usage vs sales over time · inventory value by
category · sales and margin trend · top-selling items / table models · top
consumed components · cost per table trend · ageing buckets.

**Later (analytics):** demand forecasting per item, reorder points from lead-time
variability (safety stock), ABC classification, price analysis by customer group.

---

## 17. Security & controls

- RBAC on every route (middleware checks the `permission` string).
- Server-side validation (zod) on every request; Mongo sanitisation; Helmet; CORS
  allow-list; rate limiting on auth.
- Passwords hashed with argon2/bcrypt; login lockout after repeated failures.
- No API to edit stock balances or cost layers directly.
- Immutable posted documents; corrections only through reversing documents.
- Private file storage; signed URLs; audited downloads.
- Secrets in environment variables (`.env` never committed); a `.env.example` is provided.
- Backups: scheduled `mongodump` to separate storage, with a **tested** restore procedure
  before go-live.
- Audit log is append-only.

---

## 18. Non-functional requirements

- p95 API response < 500 ms for normal screens at expected volume.
- Posting operations are idempotent (client sends an `Idempotency-Key`) so that
  double-clicks don't double-post.
- All lists are paginated, filterable and sortable server-side.
- The app works on tablet and phone width (the workshop and store use tablets).
- Logs are structured JSON (pino), with a request id on every log line.
