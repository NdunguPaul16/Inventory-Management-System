# Stock engine

The FIFO stock ledger lives here: `postIn`, `postOut`, `transfer`, `reverse`.
It is the only code allowed to write `stock_movements`, `cost_layers` and
`stock_balances` (spec §3, §5).

<!-- TODO(phase-2): implement the engine, test-first, with >= 90% coverage. -->
