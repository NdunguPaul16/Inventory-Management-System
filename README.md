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

## Documentation

| Document | Purpose |
|---|---|
| [Project specification](docs/01-project-specification.md) | Master blueprint: domain rules, FIFO engine, modules, data model, API, pages |
| [Development phases](docs/02-development-phases.md) | Phase-by-phase build plan with tasks and acceptance criteria |
| [Decisions log](docs/03-decisions-log.md) | Decided items and open questions with working assumptions |
| [Claude Code prompts](docs/04-claude-code-prompts.md) | Ready-to-paste prompts for building each phase with Claude Code |

## Status

📐 Specification complete. **Next: Phase 0 (project setup).**
