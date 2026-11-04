# Backend domains

Each implemented domain owns its routes, services and models. Add controllers, repositories and local validation only when the feature needs them; shared request and response schemas stay in `../../../shared/`. `audit/`, `counters/` and `health/` are cross-cutting support modules. `inventory/engine/` is the only stock ledger writer. Folders containing only a README are reserved for later phases.
