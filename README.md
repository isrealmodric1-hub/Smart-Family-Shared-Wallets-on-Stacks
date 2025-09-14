# FamilyVault: Smart Family Shared Wallets on Stacks

## Overview

**FamilyVault** is a decentralized Web3 application built on the Stacks blockchain using Clarity smart contracts. It implements multi-user shared wallets for families or households, where spending is enforced via programmable limits. This solves real-world problems like:

- **Family Budgeting Challenges**: Parents often struggle to enforce spending limits for children or shared expenses, leading to overspending or financial disputes. FamilyVault automates limits (e.g., $50/week for groceries per child) without relying on trust or manual tracking.
- **Transparency and Accountability**: All family members can view transaction history on-chain, reducing arguments over "who spent what" and promoting financial literacy.
- **Shared Household Management**: Couples or roommates can contribute funds and spend collaboratively, with categories for bills, entertainment, etc., preventing one person from draining the pot.
- **Security in Digital Finance**: Unlike traditional banks, smart contracts ensure immutable rules—no overrides without consensus—mitigating risks like unauthorized large withdrawals.

FamilyVault uses 6 core Clarity smart contracts to create a robust, auditable system. It's designed for easy deployment on Stacks testnet/mainnet and integrates with wallets like Leather or Hiro.

## Features

- **Multi-User Access**: Add/remove family members with roles (Owner: full control; Member: limited spending; Viewer: read-only).
- **Enforced Spending Limits**: Per-user or per-category limits (e.g., daily/weekly/monthly caps) checked on every withdrawal.
- **Categorized Budgets**: Tag spends (e.g., "groceries", "fun") and allocate budgets dynamically.
- **Approval Workflows**: Spends exceeding limits require multi-signature approval from owners.
- **On-Chain Audit Logs**: Immutable transaction history with events for easy querying.
- **Emergency Pauses**: Owners can pause the wallet in crises (e.g., lost card).
- **SIP-010 Token Integration**: Supports STX and fungible tokens for deposits/withdrawals.

## Architecture

FamilyVault comprises 6 interconnected Clarity smart contracts, each handling a specific concern for modularity and upgradability. Contracts interact via cross-contract calls, using traits for secure interfaces.

### 1. **FamilyWallet** (Core Wallet Contract)
   - Manages the shared principal STX balance.
   - Functions: `deposit()`, `withdraw(amount, memo)`, `get-balance()`.
   - Enforces: Calls `SpendingGuard` before any withdrawal.
   - Real-World Solve: Central pot for family funds, preventing siloed accounts.

### 2. **MemberManager** (User Management Contract)
   - Handles onboarding/offboarding: `add-member(principal, role)`, `remove-member(principal)`, `update-role()`.
   - Roles: `owner` (unlimited), `member` (limit-bound), `viewer` (no spend).
   - Enforces: Only owners can modify membership; uses maps for efficient lookups.
   - Real-World Solve: Easy family growth/shrinkage (e.g., adding a new baby or adult child).

### 3. **LimitSetter** (Budget Configuration Contract)
   - Sets limits: `set-user-limit(principal, category, amount, period)` (e.g., 5000µSTX/week for "groceries").
   - Supports categories via enums; tracks usage with maps/tuples.
   - Functions: `get-limit(principal, category)`, `reset-periodic-limits()`.
   - Real-World Solve: Custom budgets tailored to family needs, auto-resetting for recurring limits.

### 4. **SpendingGuard** (Enforcement Contract)
   - Validates spends: `check-spend(principal, amount, category)`—reverts if over limit.
   - Updates usage trackers post-approval.
   - Integrates with `ProposalManager` for excess spends.
   - Real-World Solve: Prevents impulse buys, teaching fiscal responsibility on-chain.

### 5. **ProposalManager** (Approval Workflow Contract)
   - For spends > limit: `create-proposal(amount, category, memo)`, `approve-proposal(id, principal)`, `execute-proposal(id)`.
   - Requires threshold (e.g., 2/3 owners) via counters.
   - Time-bound: Expires after 7 days.
   - Real-World Solve: Collaborative decisions for big purchases (e.g., family vacation).

### 6. **AuditLogger** (Transparency Contract)
   - Logs events: `log-transaction(type, amount, category, principal, timestamp)`.
   - Queryable: `get-transactions(since, until)`.
   - Emits Clarity events for off-chain indexing (e.g., via Stacks Explorer).
   - Real-World Solve: Full visibility into spending patterns, aiding tax/audit prep.

**Inter-Contract Flow Example**:
1. Member calls `FamilyWallet.withdraw(1000, "groceries")`.
2. `FamilyWallet` → `SpendingGuard.check-spend()` → If over, → `ProposalManager.create-proposal()`.
3. Owners approve via `ProposalManager`.
4. On execution: Update limits in `LimitSetter`, log in `AuditLogger`, transfer STX.

All contracts use secure patterns: Principal-based auth, error handling with `err` types, and no direct STX transfers outside controlled functions.

## Smart Contract Code Snippets

Below are simplified excerpts in Clarity. Full code is in `/contracts/` directory (assumed structure: each contract in its own `.clar` file).

### FamilyWallet.clar (Excerpt)
```clarity
(define-constant ERR-UNAUTHORIZED (err u100))
(define-constant ERR-OVER_LIMIT (err u101))

(define-data-var owners (list principal) '())

(define-map balances { wallet: principal } uint)

(define-public (deposit)
  (let ((sender tx-sender))
    (as-contract (contract-call? .SpendingGuard validate-deposit sender))
    (map-set balances { wallet: sender } (+ (get-balance sender) tx-sponsor-tx-id)) ;; Simplified; use actual STX transfer
    (ok true)))

(define-read-only (get-balance (wallet principal))
  (default-to u0 (map-get? balances { wallet: wallet })))

(define-public (withdraw (amount uint) (memo (string-ascii 34)) (category (string-ascii 20)))
  (let ((sender tx-sender))
    (asserts! (contract-call? .MemberManager is-member sender) ERR-UNAUTHORIZED)
    (asserts! (contract-call? .SpendingGuard check-spend sender amount category) ERR-OVER_LIMIT)
    ;; Transfer STX to sender
    (as-contract (stx-transfer? amount tx-sender))
    (contract-call? .AuditLogger log-transaction "withdraw" amount category sender block-height)
    (contract-call? .LimitSetter deduct-usage sender category amount)
    (ok true)))
```

### MemberManager.clar (Excerpt)
```clarity
(define-data-var members (list 100 principal) '())
(define-map roles { member: principal } (string-ascii 10)) ;; "owner", "member", "viewer"

(define-public (add-member (new-member principal) (role (string-ascii 10)))
  (let ((sender tx-sender))
    (asserts! (is-eq (unwrap! (map-get? roles { member: sender }) ERR-UNAUTHORIZED) "owner") ERR-UNAUTHORIZED)
    (var-set members (unwrap! (as-max-len? (append members new-member) u100) ERR-UNAUTHORIZED))
    (map-set roles { member: new-member } role)
    (ok true)))

(define-read-only (is-member (principal principal))
  (is-some (member principal members)))
```

*(Similar structure for other contracts: LimitSetter uses maps like `{ user: principal, cat: string, period: uint } -> uint` for limits/usage; SpendingGuard computes remaining = limit - usage; etc.)*

## Installation & Deployment

### Prerequisites
- [Clarity](https://docs.stacks.co/clarity) knowledge.
- [Stacks CLI](https://docs.stacks.co/stacks-cli) installed.
- Node.js for testing (via Clarinet).

### Setup
1. Clone repo: `git clone <repo-url> && cd familyvault`
2. Install deps: `npm install` (for testing scripts).
3. Test locally: `clarinet integrate` (uses Clarinet framework).
4. Deploy to Testnet:
   ```
   clarinet deploy --network testnet
   ```
   - Update `Clarity.toml` with your deployer key.
   - Contracts deploy in order: MemberManager → LimitSetter → SpendingGuard → ProposalManager → AuditLogger → FamilyVault.

### Configuration
- Set initial owner: Call `MemberManager.add-member` with your principal as owner.
- Fund wallet: Use `FamilyWallet.deposit()` via Stacks wallet.

## Usage

1. **Onboard Family**:
   - Owner: `MemberManager.add-member <child-principal> "member"`
   - Set limits: `LimitSetter.set-user-limit <child> "fun" 1000000 u604800` (1 STX/week)

2. **Daily Spend**:
   - Child: `FamilyWallet.withdraw 500 "fun"` → Auto-approved if under limit.

3. **Big Spend**:
   - Triggers proposal: Owners review/approve via `ProposalManager`.

4. **View History**:
   - Query `AuditLogger.get-transactions 0 block-height` on Stacks Explorer.

## Testing

- Unit tests in `/tests/` using Clarinet: e.g., simulate over-limit withdraw (should fail).
- Integration: Deploy locally, fund with faucet STX, test full flow.

## Contributing

- Fork, PR with tests.
- Issues: Budget edge cases, token support.

## License

MIT License. See [LICENSE](LICENSE).
