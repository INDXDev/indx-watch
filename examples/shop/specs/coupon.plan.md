# Shop Coupon Test Plan

## Application Overview

The shop is a small web store. A guest adds products to the cart, enters a coupon code in the cart and places an order. A valid coupon adds a discount line and lowers the total; an expired or unknown coupon shows an error and leaves the total unchanged.

## Test Scenarios

### 1. Applying Coupons

**Seed:** `tests/seed.spec.ts`

#### 1.1. should-apply-valid-coupon

**File:** `tests/applying-coupons/should-apply-valid-coupon.spec.ts`

**Steps:**
  1. Click "Add Canvas Tote to cart" on the home page
    - expect: The header link shows 'Cart (1)'
  2. Open the cart and type 'SUMMER10' into the 'Coupon code' field
  3. Click the 'Apply' button
    - expect: The discount line shows '-4.00'
    - expect: The total shows '36.00'

#### 1.2. should-reject-expired-coupon

**File:** `tests/applying-coupons/should-reject-expired-coupon.spec.ts`

**Steps:**
  1. Click "Add Canvas Tote to cart" on the home page
    - expect: The header link shows 'Cart (1)'
  2. Open the cart, type 'OLD5' into the 'Coupon code' field and click 'Apply'
    - expect: An alert shows 'This coupon has expired'
    - expect: No discount line is shown
    - expect: The total stays '40.00'

#### 1.3. should-reject-unknown-coupon

**File:** `tests/applying-coupons/should-reject-unknown-coupon.spec.ts`

**Steps:**
  1. Click "Add Canvas Tote to cart" on the home page
    - expect: The header link shows 'Cart (1)'
  2. Open the cart, type 'NOPE' into the 'Coupon code' field and click 'Apply'
    - expect: An alert shows 'This coupon is not valid'
    - expect: The total stays '40.00'
