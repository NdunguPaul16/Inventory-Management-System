# Stock engine

The FIFO stock ledger lives here: `postIn`, `postOut`, `transfer`, `reverse`.
It is the only code allowed to write `stock_movements`, `cost_layers` and
`stock_balances` (spec §3, §5).

The service and ledger models are implemented here. Future Phase 2 work remains tracked in the development roadmap.
