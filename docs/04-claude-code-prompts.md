# Claude Code prompts

Paste these into Claude Code, opened in the repo root on branch `dfstock`. Claude Code
reads `CLAUDE.md` automatically. These prompts tell it which phase to build.

---

## Phase 0 — kickoff prompt

```
We are building the inventory, manufacturing and sales system described in this repo.

First, read CLAUDE.md, docs/01-project-specification.md (§2 Architecture in particular),
docs/02-development-phases.md and docs/03-decisions-log.md.

Then implement **Phase 0 — Project setup** exactly as listed in docs/02-development-phases.md:

1. Create the branch `phase-0/setup` from `dfstock`.
2. Set up an npm-workspaces monorepo with `client/`, `server/` and `shared/` (layout in spec §2.1).
3. server: Express + TypeScript, pino logging, central error handler using the error envelope,
   `GET /api/v1/health` that reports app and MongoDB status, env config validated with zod,
   MongoDB connection via Mongoose, and a `counters` service with an atomic `$inc`
   (format e.g. `GRN-2026-00042`) plus tests.
4. client: Vite + React + TypeScript + Tailwind + React Router + TanStack Query, with a base layout
   (navy sidebar with menu placeholders for every module in spec §15, top bar, white content area)
   and a page that calls the health endpoint.
5. shared: a package exporting zod and shared types, used by both client and server.
6. Testing: Vitest on the client; Vitest/Jest + Supertest on the server, using
   mongodb-memory-server in **replica-set mode** (needed for transactions).
   Add one transaction smoke test.
7. Tooling: strict tsconfig, ESLint + Prettier, husky + lint-staged. Root scripts:
   `dev` (runs client and server together), `build`, `lint`, `typecheck`, `test`.
8. GitHub Actions CI: install → lint → typecheck → test, on push and pull requests.
9. `.env.example` and a README section on how to run the project locally.

Rules: don't build anything from Phase 1 or later. Run lint, typecheck and tests before
finishing. Use small conventional commits. When done, tick the Phase 0 checklist in
docs/02-development-phases.md, list how each acceptance criterion was met, then push the
branch and open a PR into `dfstock`.
```

---

## Generic prompt for later phases

Replace `<N>` and `<Name>`:

```
Read CLAUDE.md and docs/01–03. We are now implementing **Phase <N> — <Name>** from
docs/02-development-phases.md.

1. Create the branch `phase-<N>/<short-name>` from the latest `dfstock`.
2. Before writing code, give me a short plan: the models, endpoints, pages and tests
   you will add, mapped to the phase checklist and the spec sections it references.
   Point out any ambiguity that the decisions log doesn't answer. Wait for my OK.
3. Implement the plan in small commits. Backend first (models → services → routes → tests),
   then the frontend.
4. Write every "Tests (must have)" item for the phase, plus tests that prove each acceptance criterion.
5. Run lint, typecheck and tests until they pass.
6. Tick the phase checklist, update the spec or decisions log if a rule changed,
   summarise how each acceptance criterion was met, then push and open a PR into `dfstock`.
```

---

## Phase 2 — extra guidance (stock engine)

Add this to the generic prompt when starting Phase 2:

```
The FIFO stock engine is the most critical code in the system. Requirements:
- A pure service in server/src/engine with postIn, postOut, transfer and reverse,
  all inside Mongo transactions.
- Lock the item+location balance document (findOneAndUpdate with a version bump)
  so concurrent OUT postings can never oversell.
- Test-driven: write the tests listed in Phase 2 first, including
  "lot A 10 @ 26,000, lot B 10 @ 28,000, issue 12 → cost 316,000"
  and a parallel-posting test.
- Coverage of engine/ must be ≥ 90%.
```
