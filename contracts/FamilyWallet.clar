(impl-trait .sip-005-sft-trait.sip-005-sft-trait)
(impl-trait .sip-010-trait-ft-standard.sip-010-trait)

(define-constant ERR-UNAUTHORIZED (err u100))
(define-constant ERR-OVER-LIMIT (err u101))
(define-constant ERR-INSUFFICIENT-BALANCE (err u102))
(define-constant ERR-INVALID-AMOUNT (err u103))
(define-constant ERR-INVALID-CATEGORY (err u104))
(define-constant ERR-MAX-MEMBERS-EXCEEDED (err u105))
(define-constant ERR-MEMBER-NOT-FOUND (err u106))
(define-constant ERR-INVALID-ROLE (err u107))
(define-constant ERR-PERIOD-NOT-RESET (err u108))
(define-constant ERR-APPROVAL-REQUIRED (err u109))
(define-constant ERR-INVALID-MEMO (err u110))
(define-constant ERR-INVALID-PERIOD (err u111))
(define-constant ERR-WALLET-PAUSED (err u112))

(define-data-var total-balance uint u0)
(define-data-var max-members uint u10)
(define-data-var is-paused bool false)
(define-data-var next-proposal-id uint u0)
(define-data-var approval-threshold uint u2)

(define-map members { principal: principal }
  { role: (string-ascii 10), joined-at: uint, active: bool })

(define-map member-limits { principal: principal, category: (string-ascii 20), period: uint }
  uint)

(define-map usage-trackers { principal: principal, category: (string-ascii 20), period: uint }
  uint)

(define-map proposals { id: uint }
  { amount: uint, category: (string-ascii 20), memo: (string-ascii 34),
    proposer: principal, approvals: uint, executed: bool, expires-at: uint })

(define-map balances { principal: principal } uint)

(define-read-only (get-total-balance) (var-get total-balance))

(define-read-only (get-member (who principal))
  (map-get? members { principal: who }))

(define-read-only (get-limit (who principal) (cat (string-ascii 20)) (per uint))
  (map-get? member-limits { principal: who, category: cat, period: per }))

(define-read-only (get-usage (who principal) (cat (string-ascii 20)) (per uint))
  (map-get? usage-trackers { principal: who, category: cat, period: per }))

(define-read-only (get-proposal (id uint))
  (map-get? proposals { id: id }))

(define-read-only (get-member-balance (who principal))
  (default-to u0 (map-get? balances { principal: who })))

(define-private (validate-amount (amt uint))
  (if (> amt u0) (ok true) (err ERR-INVALID-AMOUNT)))

(define-private (validate-category (cat (string-ascii 20)))
  (if (or (is-eq cat "groceries") (is-eq cat "fun") (is-eq cat "bills")
          (is-eq cat "transport") (is-eq cat "other"))
      (ok true)
      (err ERR-INVALID-CATEGORY)))

(define-private (validate-memo (memo (string-ascii 34)))
  (if (<= (len memo) u34) (ok true) (err ERR-INVALID-MEMO)))

(define-private (validate-period (per uint))
  (if (or (is-eq per u86400) (is-eq per u604800) (is-eq per u2592000))
      (ok true)
      (err ERR-INVALID-PERIOD)))

(define-private (is-owner (who principal))
  (let ((mem (unwrap! (map-get? members { principal: who }) false)))
    (is-eq (get role mem) "owner")))

(define-private (is-member (who principal))
  (let ((mem (unwrap! (map-get? members { principal: who }) false)))
    (get active mem)))

(define-private (check-pause)
  (asserts! (not (var-get is-paused)) (err ERR-WALLET-PAUSED))
  (ok true))

(define-public (deposit (amount uint))
  (begin
    (try! (validate-amount amount))
    (try! (check-pause))
    (let ((sender tx-sender)
          (new-bal (+ (get-member-balance sender) amount)))
      (asserts! (<= (fold add-member-count u0 members) (var-get max-members)) (err ERR-MAX-MEMBERS-EXCEEDED))
      (if (is-none (get-member sender))
          (begin
            (map-set members { principal: sender }
              { role: "member", joined-at: block-height, active: true })
            (map-set balances { principal: sender } amount))
          (map-set balances { principal: sender } new-bal))
      (var-set total-balance (+ (var-get total-balance) amount))
      (print { event: "deposit", sender: sender, amount: amount })
      (ok true))))

(define-public (withdraw (amount uint) (memo (string-ascii 34)) (category (string-ascii 20)) (period uint))
  (let ((sender tx-sender)
        (mem (unwrap! (map-get? members { principal: sender }) (err ERR-MEMBER-NOT-FOUND))))
    (try! (validate-amount amount))
    (try! (validate-memo memo))
    (try! (validate-category category))
    (try! (validate-period period))
    (try! (check-pause))
    (asserts! (get active mem) (err ERR-UNAUTHORIZED))
    (let ((role (get role mem))
          (bal (get-member-balance sender))
          (tot-bal (var-get total-balance)))
      (if (is-eq role "owner")
          (begin
            (asserts! (>= tot-bal amount) (err ERR-INSUFFICIENT-BALANCE))
            (var-set total-balance (- tot-bal amount))
            (stx-transfer? amount tx-sender sender)
            (print { event: "owner-withdraw", sender: sender, amount: amount })
            (ok true))
          (if (is-eq role "member")
              (let ((lim (default-to u0 (get-limit sender category period)))
                    (used (default-to u0 (get-usage sender category period)))
                    (rem (- lim used)))
                (if (>= rem amount)
                    (begin
                      (map-set usage-trackers { principal: sender, category: category, period: period } (+ used amount))
                      (asserts! (>= tot-bal amount) (err ERR-INSUFFICIENT-BALANCE))
                      (var-set total-balance (- tot-bal amount))
                      (stx-transfer? amount tx-sender sender)
                      (print { event: "member-withdraw", sender: sender, amount: amount })
                      (ok true))
                    (if (>= lim u0)
                        (begin
                          (print { event: "proposal-needed", sender: sender, amount: amount })
                          (err ERR-APPROVAL-REQUIRED))
                        (err ERR-OVER-LIMIT))))
              (err ERR-INVALID-ROLE))))))

(define-public (create-proposal (amount uint) (memo (string-ascii 34)) (category (string-ascii 20)) (period uint))
  (let ((sender tx-sender)
        (next-id (var-get next-proposal-id))
        (exp (+ block-height u5040)))
    (try! (validate-amount amount))
    (try! (validate-memo memo))
    (try! (validate-category category))
    (try! (validate-period period))
    (asserts! (is-member sender) (err ERR-UNAUTHORIZED))
    (map-set proposals { id: next-id }
      { amount: amount, category: category, memo: memo,
        proposer: sender, approvals: u0, executed: false, expires-at: exp })
    (var-set next-proposal-id (+ next-id u1))
    (print { event: "proposal-created", id: next-id })
    (ok next-id)))

(define-public (approve-proposal (id uint))
  (let ((sender tx-sender)
        (prop (unwrap! (map-get? proposals { id: id }) (err ERR-MEMBER-NOT-FOUND)))
        (apps (get approvals prop)))
    (asserts! (is-member sender) (err ERR-UNAUTHORIZED))
    (asserts! (not (get executed prop)) (err ERR-UNAUTHORIZED))
    (asserts! (< block-height (get expires-at prop)) (err ERR-PERIOD-NOT-RESET))
    (let ((new-apps (+ apps u1)))
      (if (>= new-apps (var-get approval-threshold))
          (begin
            (map-set proposals { id: id }
              { amount: (get amount prop), category: (get category prop), memo: (get memo prop),
                proposer: (get proposer prop), approvals: new-apps, executed: true, expires-at: (get expires-at prop) })
            (try! (execute-approved-withdraw (get amount prop) (get category prop) (get memo prop) (get proposer prop)))
            (print { event: "proposal-approved", id: id })
            (ok true))
          (begin
            (map-set proposals { id: id }
              { amount: (get amount prop), category: (get category prop), memo: (get memo prop),
                proposer: (get proposer prop), approvals: new-apps, executed: false, expires-at: (get expires-at prop) })
            (ok u1))))))

(define-private (execute-approved-withdraw (amount uint) (category (string-ascii 20)) (memo (string-ascii 34)) (to principal))
  (begin
    (asserts! (>= (var-get total-balance) amount) (err ERR-INSUFFICIENT-BALANCE))
    (var-set total-balance (- (var-get total-balance) amount))
    (stx-transfer? amount tx-sender to)
    (let ((used (default-to u0 (get-usage to category u604800))))
      (map-set usage-trackers { principal: to, category: category, period: u604800 } (+ used amount)))
    (print { event: "approved-withdraw", to: to, amount: amount })
    (ok true)))

(define-public (set-limit (who principal) (cat (string-ascii 20)) (lim uint) (per uint))
  (begin
    (asserts! (is-owner tx-sender) (err ERR-UNAUTHORIZED))
    (try! (validate-category cat))
    (try! (validate-period per))
    (try! (validate-amount lim))
    (map-set member-limits { principal: who, category: cat, period: per } lim)
    (ok true)))

(define-public (reset-usage (who principal) (cat (string-ascii 20)) (per uint))
  (begin
    (asserts! (is-owner tx-sender) (err ERR-UNAUTHORIZED))
    (map-set usage-trackers { principal: who, category: cat, period: per } u0)
    (ok true)))

(define-public (pause-wallet (pause bool))
  (begin
    (asserts! (is-owner tx-sender) (err ERR-UNAUTHORIZED))
    (var-set is-paused pause)
    (ok true)))

(define-public (add-member (who principal) (role (string-ascii 10)))
  (begin
    (asserts! (is-owner tx-sender) (err ERR-UNAUTHORIZED))
    (asserts! (or (is-eq role "member") (is-eq role "viewer")) (err ERR-INVALID-ROLE))
    (asserts! (is-none (get-member who)) (err ERR-UNAUTHORIZED))
    (map-set members { principal: who }
      { role: role, joined-at: block-height, active: true })
    (ok true)))

(define-public (remove-member (who principal))
  (begin
    (asserts! (is-owner tx-sender) (err ERR-UNAUTHORIZED))
    (asserts! (is-member who) (err ERR-MEMBER-NOT-FOUND))
    (map-set members { principal: who }
      { role: (get role (unwrap! (get-member who) { role: "", joined-at: u0, active: false })),
        joined-at: (get joined-at (unwrap! (get-member who) { role: "", joined-at: u0, active: false })),
        active: false })
    (ok true)))