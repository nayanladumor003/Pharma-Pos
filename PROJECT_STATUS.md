# PROJECT_STATUS.md — Project Roadmap & Implementation Audit

This document details the **factual, verified state of the Pharma POS application**. It distinguishes between implemented features, partial implementations, known limitations, and future roadmaps.

---

## 1. Current Development Phase
- **Current Phase**: **Phase 2 — Backend Migration In Progress (Node.js + Express + MongoDB Atlas)**
- **Frontend Runtime**: React 19 + Vite 6 + Tailwind CSS v4, UI/UX unchanged from Phase 1 (no redesign, no dark mode).
- **Frontend Persistence (current)**: Still browser `localStorage` via `src/services/*` — the frontend has **not yet been switched over** to the new backend API. That cutover is planned (see §6) and has not started.
- **Backend Runtime (new, `server/`)**: Node.js + TypeScript + Express, MongoDB Atlas via Mongoose, JWT auth (access + rotating/revocable refresh tokens), server-authoritative business logic, Mongo multi-document transactions for every state-changing operation, Atlas Search (nGram autocomplete) for POS medicine search.
- **Backend implementation status** (migration phases, in order — each reviewed and explicitly approved before the next began):

  | Phase | Scope | Status |
  |---|---|---|
  | A | Codebase/backend audit | ✅ Approved |
  | B | Backend foundation (Express app, Mongo connection, error/response envelope, rate limiting, security headers) | ✅ Approved |
  | C | Mongoose models + indexes for the full domain | ✅ Approved |
  | D | Authentication + RBAC (login/refresh/logout, bcrypt, JWT rotation with reuse detection, permission middleware) | ✅ Approved |
  | E | Medicines + Inventory API (CRUD, search, batches, FEFO primitives, stock adjustments, expiry radar, low-stock) | ✅ Approved |
  | F | Sales/POS backend (server-authoritative FEFO + GST + totals, atomic stock deduction, idempotent sale creation, transactions) | ✅ Approved |
  | G | Customers + Khata (CRUD, search, ledger, atomic settlement, credit-sale integration) | ✅ Approved |
  | H | Purchases + Suppliers | 🔄 In progress |
  | I | Prescriptions + Returns | Planned |
  | J | Expenses + Reports | Planned |
  | K | Frontend API integration (`src/api/*` client layer, refactor `src/services/*` to call it) | Planned |
  | L | localStorage removal (business data only — no UI change) | Planned |
  | M–P | Additional test hardening, security/performance review, incremental UX (loading/error/retry states only), final documentation pass | Planned |

- Every backend API endpoint delivered so far is covered by an automated integration test suite (121 passing tests as of Phase G, run against a real MongoDB replica set via `mongodb-memory-server`, plus one environment-dependent Atlas Search test that only runs against the real Atlas cluster). See `server/` for source.

---

## 2. Implemented Modules (100% Functional)

> The table below describes the **frontend** as it runs today (still localStorage-backed — see §1). Modules with an approved backend counterpart are noted; the frontend has not yet been switched to call it (Phase K).

| Module | Verification Notes |
|---|---|
| **Dashboard (`/`)** | Operational KPI cards (Today Sales, Transactions, Khata Balance, Near Expiry), 5 triage radar tabs with filtering, Dispensing Velocity Recharts trend, and fast action triggers. |
| **POS Terminal (`/pos`)** | Real-time drug search, barcode auto-selection, FEFO batch assignment, batch switcher modal, patient Khata selector with allergy alerts, cart discounts, held sales management (`F4`/`F8`), exact cash tender shortcuts, UPI/Split/Credit payment flows, completed invoice modal with thermal receipt rendering. |
| **Sales Invoices (`/sales`)** | Paginated invoice table, search by invoice#/patient/phone, payment method filters, itemized inspection drawer with batch-level breakdown, refund trigger, thermal receipt reprint. |
| **Inventory Ledger (`/inventory`)** | Master batch table with rack locations, Near-Expiry loss calculator (<30d, <60d, <90d), stock audit adjustments (Add, Subtract, Set, Damage, Expiry), and immutable stock movements audit trail. |
| **Medicines Catalog (`/medicines`)** | Master catalog view with category filters, generic salt search, Schedule H indicators, stock levels, add/edit drug modal, and new batch creation modal. |
| **Purchases / Inward PO (`/purchases`)** | Inward purchase order logger with supplier selection, batch numbers, manufacturing/expiry dates, bonus free quantities, purchase prices, and automatic stock inwarding upon "Received" status. |
| **Customers & Khata CRM (`/customers`)** | Patient records with chronic conditions, drug allergies, credit limits, outstanding balances, lifetime spend, purchase history drawer, and debt settlement modal. |
| **Suppliers Directory (`/suppliers`)** | Distributor database with contact details, GSTIN, Drug License numbers, credit terms, and outstanding payables tracker. |
| **Prescriptions (`/prescriptions`)** | Doctor prescription logger with patient info, doctor registration number, diagnosis, multi-drug regimen, and **1-click Transfer to POS Cart** with automatic status update. |
| **Returns (`/returns`)** | Sales returns against original invoice with restockable batch increment and refund recording; Purchase returns for supplier debit notes. |
| **Expenses (`/expenses`)** | Operating overhead logger (Rent, Cold chain power, Bio-waste, Salaries) with category breakdowns and payment method tagging. |
| **Reports (`/reports`)** | Gross profit %, monthly revenue vs. expense charts, category sales distribution pie charts, payment method breakdown, and data export triggers. |
| **Employees & Permissions (`/employees`)** | Staff roster, roles (Admin, Pharmacist, Cashier), shift timings, and permission capabilities. |
| **Settings (`/settings`)** | Pharmacy business profile (GSTIN, DL 20B/21B, FSSAI), POS receipt layout preferences (58mm, 80mm, A4), expiry alert thresholds, full JSON store backup download, and store reset. |
| **Global Navigation & Modals** | Global Quick Action (`Alt+N`), Global Search (`Ctrl+K`), Keyboard Shortcuts Reference (`?`), and dynamic Toast notification stack. |

---

## 3. Partially Implemented / Simulated Capabilities

- **Thermal Receipt Printing**: Uses standard browser `window.print()` targeting formatted HTML receipt layouts rather than raw ESC/POS binary socket connections.
- **Barcode Scanning**: Implemented using standard keyboard buffer input (scanners configured in Keyboard Wedge mode that terminate with `Enter`).
- **Data Export**: Implemented as client-side JSON/CSV export files triggered via browser download.

---

## 4. Known Limitations & Technical Constraints

1. **Browser Storage Limits**: Data is stored in browser `localStorage`. Exceeding browser quota (~5MB) in high-volume testing could cause serialization errors. Clearing browser cookies/cache resets data to defaults.
2. **Single-Device State**: Changes made on one browser/device do not automatically synchronize to another workstation in real time without a central backend.
3. **No Hardware Cash Drawer Trigger**: Standard web browsers cannot send raw RJ12 electric pulses to kick open physical cash drawers without a native Electron or local hardware bridge service.
4. **Backend not yet wired to the frontend**: The `server/` API is functionally complete for auth, medicines/inventory, sales/POS, and customers/Khata, but `src/services/*` still reads/writes localStorage. Until Phase K, the two are independent — the backend has its own test suite and has been manually verified against the real Atlas cluster, but nothing in the running app currently calls it.
5. **Atlas Search indexing lag**: newly-created medicines can take up to ~15s to become findable via POS free-text search on the current (shared-tier) Atlas cluster — exact-match barcode/SKU lookups are unaffected (standard indexes, no lag).

---

## 5. Backend Migration — Explicitly Deferred Decisions & Preserved Behaviors

These were identified during Phases F–G, deliberately **not** resolved or changed, and must not be revisited except where a later phase's business requirements make it directly necessary:

1. **No dedicated Customer/Khata permissions.** `view_pos` (reads) and `create_sale` (writes, incl. settlement) are reused rather than inventing a new `Permission` value — every seeded role that touches customers today already holds them. A dedicated `manage_customers`-style permission is a future refinement, not a current gap to fix reactively.
2. **Customer overpayment stays floored at zero.** If a Khata payment exceeds the outstanding balance, the excess is not tracked as a credit/advance owed back to the customer — this matches the original frontend's `Math.max(0, ...)` behavior exactly. No advance-balance or customer-credit concept exists and none should be introduced without an explicit product decision.
3. **`CustomerLedgerEntry` types `Adjustment` and `ReturnCredit` are schema-only.** No API writes them yet. They stay reserved for when Returns (Phase I) or a future manual-correction workflow actually needs them.
4. **The GST/discount calculation follows the live `usePOSStore.ts` code, not `BUSINESS_RULES.md` Rule 2.2's written formula** (the two disagree on whether cart-wide discount reduces the tax base before or after per-line tax is computed — the running code does it before, matching what pharmacists have actually been billing against). This is intentional and documented in `server/src/services/pricingEngine.ts`; do not "fix" it back to the doc's formula without a deliberate decision, since that would silently change real pricing.

---

## 6. Future Direction (Remaining Backend Migration Phases)

The backend architecture question is **resolved** (Node.js + Express + MongoDB Atlas + Mongoose — see §1), not a future unknown; the items below are what's still ahead within that already-chosen architecture:

- **Phase H (in progress)**: Purchases + Suppliers API.
- **Phase I**: Prescriptions + Returns API (this is also where `Adjustment`/`ReturnCredit` ledger entries get their first write path).
- **Phase J**: Expenses + Reports API (aggregation-based, not naive full-collection loads).
- **Phase K**: Frontend integration — a `src/api/*` client layer, with `src/services/*` refactored to call it instead of localStorage. No UI/UX redesign as part of this.
- **Phase L**: Removal of localStorage as a source of truth for business data (UI-only preferences, if any, may remain local).
- **Phases M–P**: Expanded test hardening, a dedicated security/performance pass, incremental UX improvements (loading/error/retry/pagination states only — not a visual redesign), and a final documentation sync across all `.md` files.
- **Hardware Integration** (unchanged from the original plan, still not started): a lightweight local bridge (WebSocket/WebHID/WebUSB) for ESC/POS thermal printers, scales, and cash drawer triggers.
- **Government Compliance Integration** (unchanged, still not started): direct integration with the Indian GST e-Invoicing API and E-Way Bill generation.
