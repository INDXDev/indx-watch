_Test report · internal_

# Shop — Release v1.2.0

- **Scope:** staging
- **Generated:** 2026-11-19 00:00 UTC · by qa@shop.test

> **✕ Not ready to ship** — 3 of 8 readiness checks fail.

| Check | Now | Needed | Result |
| --- | ---: | ---: | --- |
| At least one P0/P1 test case is in scope | `8` | `≥ 1` | ✓ Pass |
| Every P0 criterion has a test | `6/6` | `≥ 1.00` | ✓ Pass |
| Every P0 test passes _TC-4, TC-6, TC-8_ | `3/6` | `6/6` | ✕ Fail |
| P1 tests pass (or are waived) | `2/2 (1.00)` | `≥ 0.95` | ✓ Pass |
| P0–P1 results waiting for review _TC-6_ | `1` | `≤ 0` | ✕ Fail |
| P0–P1 tests not run or blocked | `0` | `≤ 0` | ✓ Pass |
| P0–P1 results from an older version _TC-8_ | `1` | `≤ 0` | ✕ Fail |
| Passing P0 results have evidence | `3/3` | `3/3` | ✓ Pass |

## Summary

✓ Pass: **4** · ✕ Fail: **1** · ? Needs review: **1** · ↻ Outdated: **1** · ○ Not tested: **0** · ≈ Waived: **1**

Acceptance criteria with a test: **8/9 (89%)**

| Priority | Pass | Fail | Needs review | Outdated | Not tested | Waived | AC coverage |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| P0 | 3 | 1 | 1 | 1 | 0 | 0 | 6/6 |
| P1 | 1 | 0 | 0 | 0 | 0 | 1 | 2/2 |
| P2 | 0 | 0 | 0 | 0 | 0 | 0 | 0/1 |

## Use cases

**UC-1 Shopper finds a product · P1 · ≈ Waived · done**
- AC-1.1 The home page lists every product with its name and price. — TC-1 ✓ Pass
- AC-1.2 Searching by part of a product name shows only matching products. — TC-2 ≈ Waived

**UC-2 Guest applies a coupon at checkout · P0 · ✕ Fail**
- AC-2.1 A valid coupon reduces the order total by its discount. — TC-3 ✓ Pass
- AC-2.2 An expired coupon shows "This coupon has expired" and the total does not change. — TC-4 ✕ Fail

**UC-3 Guest places an order · P0 · ? Needs review**
- AC-3.1 Placing an order shows a confirmation page with an order number. — TC-5 ✓ Pass TC-6 ? Needs review
- AC-3.2 After the order is placed, the cart is empty. — TC-5 ✓ Pass

**UC-4 Customer signs in · P0 · ↻ Outdated**
- AC-4.1 Valid credentials show "Welcome back, Casey". — TC-7 ✓ Pass
- AC-4.2 A wrong password shows "Email or password is incorrect" and the customer stays signed out. — TC-8 ↻ Outdated

**UC-5 Customer adds a photo to a review · P2 · ! No test**
- AC-5.1 An uploaded PNG appears as a thumbnail under the review. — ! No test

## Failures and open items

| Test case | Priority | Status | Run | Step | Note | Evidence |
| --- | --- | --- | --- | ---: | --- | --- |
| TC-4 Expired coupon is rejected | P0 | ✕ Fail | `run_01JF7Z3K…0007` | 1 | Total stayed 40.00, no message (internal note) | `sha256:8760bc67a01b` |
| TC-6 Confirmation page is readable on a phone | P0 | ? Needs review | `run_01JF7Z3K…0011` | — |   | `sha256:8760bc67a01b` |
| TC-8 Wrong password is rejected | P0 | ↻ Outdated | `run_01JF7Z3K…0015` | — |   | — |

## Accepted failures (waivers)

| Test case | Reason | By | When |
| --- | --- | --- | --- |
| TC-2 | Case-insensitive search ships in v1.2.1 | Alex | 2026-11-18 23:00 |

## Coverage matrix

| Use case | Criterion | Test case | Latest result |
| --- | --- | --- | --- |
| UC-1 | AC-1.1 | TC-1 | ✓ |
| UC-1 | AC-1.2 | TC-2 | ≈ |
| UC-2 | AC-2.1 | TC-3 | ✓ |
| UC-2 | AC-2.2 | TC-4 | ✕ |
| UC-3 | AC-3.1 | TC-5, TC-6 | ✓ ? |
| UC-3 | AC-3.2 | TC-5 | ✓ |
| UC-4 | AC-4.1 | TC-7 | ✓ |
| UC-4 | AC-4.2 | TC-8 | ↻ |
| UC-5 | AC-5.1 | — | ! |

## Run log

| Test case | Version | Verdict | By | Source | Build | Environment | Ended (UTC) | Evidence | CI |
| --- | --- | --- | --- | --- | --- | --- | --- | ---: | --- |
| TC-8 | `tcv:0b7c55e1d902` | ✓ Pass ↻ Outdated | sam@shop.test (human) | manual | `a1b2c3d` | staging | 2026-11-12 09:05 | 0 | — |
| TC-2 | `tcv:1fc4935a7bd8` | ✕ Fail | octocat (ci) | playwright | `a1b2c3d` | staging | 2026-11-18 22:10 | 0 | [CI](https://github.com/INDXDev/indx-watch/actions/runs/1) |
| TC-1 | `tcv:4c31fb105036` | ✓ Pass | octocat (ci) | playwright | `a1b2c3d` | staging | 2026-11-18 22:10 | 1 | [CI](https://github.com/INDXDev/indx-watch/actions/runs/1) |
| TC-3 | `tcv:234b18516499` | ✓ Pass | octocat (ci) | playwright | `a1b2c3d` | staging | 2026-11-18 22:10 | 1 | [CI](https://github.com/INDXDev/indx-watch/actions/runs/1) |
| TC-4 | `tcv:4d8e394e3d0f` | ✕ Fail | octocat (ci) | playwright | `a1b2c3d` | staging | 2026-11-18 22:10 | 1 | [CI](https://github.com/INDXDev/indx-watch/actions/runs/1) |
| TC-5 | `tcv:b1910773f3f5` | ✓ Pass | octocat (ci) | playwright | `a1b2c3d` | staging | 2026-11-18 22:10 | 1 | [CI](https://github.com/INDXDev/indx-watch/actions/runs/1) |
| TC-6 | `tcv:c373dedbc578` | ? Needs review | octocat (ci) | playwright | `a1b2c3d` | staging | 2026-11-18 22:10 | 1 | [CI](https://github.com/INDXDev/indx-watch/actions/runs/1) |
| TC-7 | `tcv:880407595f3c` | ✓ Pass | sam@shop.test (human) | manual | `a1b2c3d` | staging | 2026-11-18 22:10 | 1 | — |

## Appendix

### Statuses

| Status |  |
| --- | --- |
| ✓ Pass | The latest result passed. |
| ✕ Fail | The latest result failed. |
| ? Needs review | A person still has to decide. |
| ↻ Outdated | The test or its data changed after the latest run; it must run again. |
| ‖ Blocked | The test could not be executed (environment down, missing data, an earlier bug). |
| ○ Not tested | No run in this scope yet. |
| ≈ Waived | A known failure accepted for this release. |
| ! No test | An acceptance criterion has no approved test case. |
| » Skipped | Out of scope this time. |

### Gate thresholds used

`p0_coverage 1 · p0_all_pass true · p1_pass_rate 0.95 · max_needs_review 0 · max_untested 0 · allow_stale false · require_evidence true`

### Decision policy used

`llm_pass_confidence 0.8 · llm_fail_confidence 0.8 · visual_threshold 0.01 · require_human_for []`

---

_Generated by INDX Watch from the project's test definitions and recorded results._
