# Inventory

The stock balances page reads the existing permission-gated balance API and displays
quantities and FIFO value by item and location. Each item links to stock detail tabs
for balances, cursor-paged FIFO layers, and cursor-paged movement history. The backend remains
authoritative for access control and stock posting.

The reconciliation page is available to users with
`inventory.reconciliation.read`. It starts a read-only check only when the user
presses the button, then displays any quantity and value differences. The
backend checks the permission again; the page does not repair stock.

The stock-count page supports item/location selection, book-balance
freeze, physical quantity or serial-set entry, separate approval, rejection and FIFO variance
posting. The backend checks every permission and rejects stale snapshots. For
serial-tracked items, missing and found serials are posted atomically, including
same-quantity swaps. The
count-specific selectors allow zero-balance items to be counted while the full
item and location master-data screens remain Phase 1 prerequisites.

The adjustment screen submits requests and shows their status, approval, rejection
and posting actions according to each user's permissions. The transfer screen posts
through the existing FIFO API with an idempotency key, including serial numbers for
serial-tracked items. Both screens use active item and location selectors supplied
by the inventory API.

The opening-stock screen supports one line at a time, optional UTC receipt date,
and the same request, approval and posting lifecycle. Its import wizard reads
CSV or XLSX files in the browser, previews up to 100 rows, and submits one batch
request using existing item SKUs and location codes. The batch posts atomically
through the FIFO engine after approval. Item and location master-data management
remains a Phase 1 prerequisite for preparing real import files.
