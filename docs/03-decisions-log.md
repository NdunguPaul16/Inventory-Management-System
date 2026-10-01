# Decisions Log

Record of business and technical decisions. **Open** items have a working
assumption so development can continue, and are revisited before the phase
that depends on them.

## Decided

| # | Decision | Date | Notes |
|---|---|---|---|
| D1 | Inventory valuation uses **FIFO** | 2026-10-01 | Cost layers per item and location (§5) |
| D2 | System is **standalone** (no QuickBooks/Xero dependency) | 2026-10-01 | Own AR/AP and reports; GL-ready events (§11) |
| D3 | The workshop **manufactures pool tables** that are sold | 2026-10-01 | BOMs + production orders; production isn't an expense (§7) |
| D4 | Selling prices **vary by customer** | 2026-10-01 | Price lists per customer group + overrides with margin floor (§8.2) |
| D5 | **KRA eTIMS** integration is in scope | 2026-10-01 | Adapter + queue (§9) |
| D6 | Stack: React + TS, Node/Express + TS, MongoDB (Atlas M0 in development) | 2026-10-01 | From the original business plan |
| D7 | Money stored as integer cents; quantities as Decimal128 | 2026-10-01 | Avoids floating-point errors |

## Open (with working assumptions)

| # | Question | Working assumption | Needed before |
|---|---|---|---|
| Q1 | Labour & overhead: a fixed standard cost per table model, or actual hours per production order? | **Standard cost per BOM** (simpler); the model leaves room for actual hours later | Phase 4 |
| Q2 | Are tables built to stock, to order, or both? | **Both**: a production order can optionally link to a sales order | Phase 4/5 |
| Q3 | How many locations (warehouse, workshop, showroom, other sites)? | **Multi-location from day one**; seed `MAIN-WH` and `WORKSHOP` | Phase 2 |
| Q4 | eTIMS path: OSCU vs VSCU, direct vs third-party integrator | To be confirmed with KRA; build against the `MOCK` adapter until then | Phase 6 |
| Q5 | MongoDB vs PostgreSQL for a ledger-heavy system | **MongoDB, with mandatory transactions** for every stock posting. Revisit only if concurrency or reporting issues appear in Phase 2 testing | Phase 2 |
| Q6 | Batch tracking for boards (which import lot went into which table)? | FIFO layers already link each table to its import lot; dedicated batch numbers are **off** unless needed | Phase 3 |
| Q7 | Landed-cost allocation default: by value, quantity, weight or volume? | **By value**, selectable per voucher | Phase 3 |
| Q8 | Production hosting & paid DB tier | Decide after Phase 9 based on real data volume | Phase 10 |
