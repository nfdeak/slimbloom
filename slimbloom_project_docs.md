# SlimBloom – Complete Project Documentation

> Last updated: April 2026  
> Codebase: `slimbloom-main`  
> Live domain: `lazyweightloss.com` / `slimbloom.vercel.app`

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Tech Stack & Third-Party Services](#2-tech-stack--third-party-services)
3. [Repository Structure](#3-repository-structure)
4. [Architecture Diagram](#4-architecture-diagram)
5. [Pages & What They Do](#5-pages--what-they-do)
6. [API Routes (Vercel Serverless Functions)](#6-api-routes-vercel-serverless-functions)
7. [Supabase Edge Functions](#7-supabase-edge-functions)
8. [Database Schema (All Tables)](#8-database-schema-all-tables)
9. [Membership Lifecycle](#9-membership-lifecycle)
10. [SMS Drip Campaign System](#10-sms-drip-campaign-system)
11. [Authentication Flow](#11-authentication-flow)
12. [Row Level Security (RLS) Model](#12-row-level-security-rls-model)
13. [Environment Variables Reference](#13-environment-variables-reference)
14. [Step-by-Step Setup Guide](#14-step-by-step-setup-guide)
15. [Common Gotchas & Notes](#15-common-gotchas--notes)

---

## 1. Project Overview

**SlimBloom** (branded as *Lazy Weight Loss*) is a **weight-loss program SaaS** built as a collection of static HTML pages, deployed on **Vercel**. It combines:

- A **quiz funnel** that collects phone numbers and drives users to a paid plan page
- **Whop** as the payment processor / subscription manager
- **Supabase** as the authentication backend and database
- **Twilio** for automated SMS follow-up campaigns
- A **member dashboard** (`/home`) where paying members access workout content
- An **admin panel** (`/admin`) for managing workout content and viewing data

The core business model is: user takes quiz → enters phone number → sees pricing → buys on Whop → gets Supabase account → accesses member dashboard.

---

## 2. Tech Stack & Third-Party Services

| Layer | Technology | Purpose |
|---|---|---|
| Hosting | **Vercel** | Static site hosting + serverless API routes |
| Frontend | Vanilla **HTML/CSS/JS** | All pages are single-file HTML |
| Auth | **Supabase Auth** | Phone OTP + email/password login |
| Database | **Supabase PostgreSQL** | Memberships, phone leads, SMS logs |
| File Storage | **Supabase Storage** | Quiz images (`quiz-images` bucket) |
| Edge Functions | **Supabase Deno Edge Functions** | SMS sending (triggered by DB webhooks) |
| Payments | **Whop** | Subscription checkout, billing, webhooks |
| SMS | **Twilio** | Automated drip SMS campaigns |
| Workout Data | **GitHub API** | `workout-data.json` stored in the repo itself |
| Webhook Verification | **Svix** | Verifies Whop webhook signatures |

---

## 3. Repository Structure

```
slimbloom-main/
│
├── index.html              # Landing page / home redirect
├── quiz.html               # Multi-step quiz funnel (phone opt-in)
├── plans.html              # Pricing / plan selection + Whop checkout
├── dashboard.html          # Member dashboard (/home) – protected
├── admin.html              # Admin panel – restricted to ADMIN_EMAIL
├── support.html            # Support / contact page
├── privacy-policy.html     # Legal
├── terms-of-use.html       # Legal
├── refund-policy.html      # Legal
├── og-image.html/.png/.svg # Open Graph image for social sharing
├── yt-banner.html          # YouTube channel art
├── workout-data.json       # Workout schedule & exercise library (source of truth)
├── favicon.svg
├── package.json            # Node deps: @supabase/supabase-js, svix
├── vercel.json             # URL rewrites and clean URLs config
│
├── api/                    # Vercel Serverless Functions (Node.js ESM)
│   ├── activate-coupon.js      # Redeem a free coupon code → create membership
│   ├── cancel-subscription.js  # Cancel active Whop subscription
│   ├── check-admin.js          # Verify if current user is admin
│   ├── check-phone.js          # Check if a phone number is already in phone_leads
│   ├── link-membership.js      # Manually link membership to account via email
│   ├── save-workout-data.js    # Admin: save workout JSON to GitHub repo
│   ├── subscription.js         # Fetch current user's active subscription
│   └── whop-webhook.js         # Receive & process Whop subscription events
│
└── supabase/
    ├── migrations/
    │   └── 20240001000000_initial_schema.sql   # DB migration (all 4 tables + RLS)
    └── functions/
        ├── send-sms/
        │   └── index.ts        # Edge fn: sends welcome SMS on new phone_lead INSERT
        └── process-sms-queue/
            └── index.ts        # Edge fn: cron job – sends follow-up drip SMS
```

---

## 4. Architecture Diagram

```
                         ┌─────────────────────────────────┐
                         │           USER BROWSER           │
                         └──────┬──────────────────────┬───┘
                                │ visits                │ auth via
                                ▼                       ▼
                   ┌─────────────────┐        ┌──────────────────┐
                   │  quiz.html      │        │ Supabase Auth    │
                   │  (phone opt-in) │        │ (Phone OTP /     │
                   └────────┬────────┘        │  Email+Password) │
                            │ insert          └────────┬─────────┘
                            │ phone_lead               │ JWT token
                            ▼                          ▼
                   ┌──────────────────┐      ┌──────────────────────┐
                   │  Supabase DB     │      │    API Routes         │
                   │  phone_leads     │      │    (Vercel /api/*)    │
                   │  memberships     │◄─────│  subscription.js      │
                   │  sms_campaigns   │      │  cancel-subscription  │
                   │  sms_log         │      │  activate-coupon      │
                   └──────┬───────────┘      │  link-membership      │
                          │                  │  check-admin          │
                          │ DB webhook       │  whop-webhook ◄───────┼── Whop
                          │ on INSERT        └──────────────────────┘
                          ▼                           ▲
                 ┌──────────────────┐                 │ POST events
                 │  Edge Functions  │       ┌─────────────────────┐
                 │  send-sms        │       │       WHOP           │
                 │  process-sms-    │       │  (Payment / Billing) │
                 │  queue (cron)    │       └─────────────────────┘
                 └───────┬──────────┘
                         │ sends via
                         ▼
                    ┌──────────┐
                    │  Twilio   │
                    │  SMS API  │
                    └──────────┘
```

---

## 5. Pages & What They Do

### `index.html` – Landing / Entry Point
Simple redirect or hero page. Entry point for paid traffic (ads, YouTube, etc.).

---

### `quiz.html` – Quiz Funnel (most important acquisition page)

This is the **top of the funnel**. Users go through a multi-step quiz about their age, weight, goals, etc.

**Key behaviors:**
- Loads `supabase-js` from CDN with the **anon key** (public, safe)
- At the end of the quiz, it asks for the user's **phone number**
- The phone number is submitted to `/api/check-phone` to check if they're already a lead
- If they answer "yes" to having bought previously, it shows a login form (phone OTP or email/password)
- The phone number is inserted into `phone_leads` via the **anon client** directly:
  ```js
  _supabase.from('phone_leads').insert({ phone: phone, quiz_answers: answers })
  ```
- Images for the quiz come from **Supabase Storage** (`quiz-images` bucket)
- After quiz completion → user is sent to `/plans` to purchase

> [!NOTE]
> The `quiz_answers` column is not in the migration template — it may be needed as a `jsonb` column on `phone_leads` if you want to persist answers. The current migration has the minimal required columns.

---

### `plans.html` – Pricing / Plan Selection

Shows the three subscription plans:

| Plan ID | Name | Price | Interval |
|---|---|---|---|
| `plan_VWsf3Cik0o7Vj` | 4-Week Plan | $19.99 | Monthly |
| `plan_CGt8PI0ipZ9vR` | 12-Week Plan | $39.99 | 3 months |
| `plan_KJiJ7FZ8lj9OR` | 24-Week Plan | $59.99 | 6 months |

**Key behaviors:**
- Loads the **Whop checkout JS** (`js.whop.com/static/checkout/loader.js`)
- When user picks a plan, it **redirects to Whop's hosted checkout**:
  ```js
  window.location.href = 'https://whop.com/checkout/' + _selectedPlanId + '/?d2c=true&returnUrl=...'
  ```
- After payment, Whop fires a webhook → `/api/whop-webhook` → row upserted into `memberships`
- Page also handles a **coupon code** flow (free access codes)

---

### `dashboard.html` – Member Dashboard (`/home`)

Protected page — users who aren't logged in are bounced to the quiz/login.

**Key behaviors:**
- Initializes Supabase with the **anon key** and calls `getSession()` on load
- Listens on `onAuthStateChange` to react to login/logout events
- Calls `/api/subscription` (with the user's JWT) to check for an active membership
- If no active membership is found → shows upsell / link-membership flow
- Displays the **workout schedule and exercise library** loaded from `workout-data.json`
- Auth flows supported:
  - **Phone OTP**: `signInWithOtp({ phone })` → `verifyOtp({ type: 'sms' })`
  - **Email + Password**: `signUp` → `signInWithPassword`
  - **Password reset**: `updateUser({ password })`
- Contains a "link membership" modal (calls `/api/link-membership`)
- Contains a "cancel subscription" button (calls `/api/cancel-subscription`)
- Reads `phone_leads` to pre-fill phone fields for logged-in phone users

---

### `admin.html` – Admin Panel

Only accessible to the user whose email matches `ADMIN_EMAIL` environment variable.

**Key behaviors:**
- Calls `/api/check-admin` on load; redirects away if not admin
- Can **edit and save** the workout schedule (`/api/save-workout-data` → GitHub API)
- Can **upload images** to Supabase Storage
- Can view/manage SMS campaigns (reads `sms_campaigns` and `sms_log` tables)
- Can view all memberships and phone leads

---

### Legal Pages
`privacy-policy.html`, `terms-of-use.html`, `refund-policy.html`, `support.html` — static content pages. No backend interaction.

---

## 6. API Routes (Vercel Serverless Functions)

All files in `/api/` are Node.js ESM serverless functions deployed automatically by Vercel. They use `@supabase/supabase-js` with the **service role key** (which bypasses RLS completely).

CORS is restricted to:
- `https://www.lazyweightloss.com`
- `https://lazyweightloss.com`
- `https://slimbloom.vercel.app`

---

### `GET /api/subscription`
**Purpose:** Fetch the current user's active membership.

**Auth:** Requires `Authorization: Bearer <JWT>` header.

**Logic:**
1. Verify JWT via `supabase.auth.getUser(token)`
2. Query `memberships` by `user_id`, most recent first
3. If found and `renewal_period_end` is in the past → auto-mark as `expired`, return `null`
4. If not found by `user_id` → **lazy email linking**: look for a row with matching `whop_user_email` and `user_id IS NULL`, then update it
5. If no email match → **lazy phone linking**: find a converted `phone_lead` matching user phone, then link the most recent unlinked membership
6. Returns `{ subscription: <membership row> }` or `{ subscription: null }`

---

### `POST /api/cancel-subscription`
**Purpose:** Cancel the user's active Whop subscription at period end.

**Auth:** Requires `Authorization: Bearer <JWT>` header.

**Logic:**
1. Verify JWT
2. Find the user's `active` or `trialing` membership
3. Call Whop API: `POST /api/v1/memberships/{whop_membership_id}/cancel` with `cancellation_mode: at_period_end`
4. Update local DB: `cancel_at_period_end = true`, `status = 'canceling'`
5. The final status sync happens when Whop fires the cancellation webhook

---

### `POST /api/activate-coupon`
**Purpose:** Redeem a free coupon code (e.g. `LAZY`) for a 30-day membership.

**Auth:** Requires `Authorization: Bearer <JWT>` header.

**Body:** `{ coupon: "LAZY" }`

**Logic:**
1. Validate coupon code against the hardcoded `VALID_COUPONS` map
2. Verify JWT
3. Check user doesn't already have an active membership
4. Check the coupon hasn't already been redeemed by this user (dedup key: `coupon_LAZY_{userId}`)
5. Insert a new membership row with `plan_price_cents: 0`, `cancel_at_period_end: true`, expires in 30 days

> [!IMPORTANT]
> To add new coupon codes, modify the `VALID_COUPONS` object in `api/activate-coupon.js`.

---

### `POST /api/link-membership`
**Purpose:** Manually link a Whop membership to a Supabase account by email.

**Auth:** Requires `Authorization: Bearer <JWT>` header.

**Body:** `{ email: "user@example.com" }`

**Logic:**
1. Verify JWT
2. Check user doesn't already have a linked membership
3. Find a `memberships` row with matching `whop_user_email` and `user_id IS NULL`
4. Update that row: `user_id = auth.uid()`

**Use case:** A user buys with one email but signs up with a different email. The admin can tell them to use the link-membership flow with their purchase email.

---

### `GET /api/check-admin`
**Purpose:** Returns `{ admin: true }` if the JWT belongs to `ADMIN_EMAIL`.

Used by `admin.html` on page load to gate access.

---

### `POST /api/check-phone`
**Purpose:** Check if a phone number already exists in `phone_leads`.

**No auth required.** Rate-limited to 5 requests per IP per 10 minutes.

**Body:** `{ phone: "+11234567890" }` (E.164 format)

Returns `{ exists: true/false }`.

Used by the quiz to decide whether to show the "already bought?" flow.

---

### `POST /api/save-workout-data`
**Purpose:** Admin-only endpoint to persist workout data changes to GitHub.

**Auth:** Requires `Authorization: Bearer <JWT>` from the admin user.

**Logic:**
1. Verify JWT and check `user.email === ADMIN_EMAIL`
2. Fetch current `workout-data.json` from GitHub to get its SHA
3. Base64-encode the new JSON payload
4. PUT to GitHub Contents API to update the file

The `workout-data.json` in the repo **is the live source of truth** for member workout content. The admin panel writes back to it via Git commit.

---

### `POST /api/whop-webhook`
**Purpose:** Receive Whop subscription lifecycle events and sync to the `memberships` table.

**No auth header** — verified via Svix webhook signature (`WHOP_WEBHOOK_SECRET`).

**Events handled** (all map to the same upsert logic):
- `membership.went_valid` (new subscriber)
- `membership.went_invalid` (expired / cancelled)
- `membership.updated` (plan change, renewal)

**Logic:**
1. Verify Svix signature using raw request body
2. Extract `membership.id`, `plan.id`, `user.email`, and status fields
3. Try to find the matching Supabase Auth user by email (optional — membership can exist without a linked user)
4. Map `plan.id` → human-readable plan details via `PLAN_MAP`
5. Upsert into `memberships` on conflict `whop_membership_id`

> [!IMPORTANT]
> The `PLAN_MAP` in `whop-webhook.js` must match the actual Whop plan IDs in your Whop dashboard. If you create new plans, add them here.

---

## 7. Supabase Edge Functions

These are **Deno TypeScript** functions deployed to Supabase's edge network (not Vercel).

---

### `send-sms` – Welcome SMS on Lead Capture

**Trigger:** Database webhook on `INSERT` into `phone_leads`

**What it does:**
1. Receives the new `phone_leads` row as a JSON payload
2. Fetches the **first step** of the `non_converter` campaign (`step_number = 1, delay_hours = 0`)
3. Waits **60 seconds** (to avoid feeling instant/robotic)
4. Sends the SMS via Twilio
5. Inserts a row into `sms_log` with status `sent` or `failed`

---

### `process-sms-queue` – Drip Campaign Cron Job

**Trigger:** Supabase Cron (run every hour via the Supabase dashboard scheduler)

**What it does:**
1. Fetches all active `sms_campaigns`
2. Fetches all `phone_leads`
3. Fetches all `sms_log` entries (to know what's already been sent)
4. For each lead × campaign step combination:
   - If already sent → skip
   - If `delay_hours` not yet elapsed → skip
   - Otherwise → send via Twilio, insert `sms_log` row
5. Uses `converted` flag to switch a lead between `non_converter` and `converter` campaign flows

**Timing base:**
- `non_converter` leads: clock starts at `phone_leads.created_at`
- `converter` leads: clock starts at `phone_leads.converted_at`

---

## 8. Database Schema (All Tables)

### `memberships`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | Auto-generated |
| `whop_membership_id` | text UNIQUE NOT NULL | Whop's membership ID (conflict key for upserts) |
| `whop_plan_id` | text | Whop plan ID |
| `whop_user_id` | text | Whop's internal user ID |
| `whop_user_email` | text | Email used at checkout |
| `user_id` | uuid FK → `auth.users` | Nullable — set via lazy linking |
| `status` | text | `active`, `trialing`, `canceling`, `canceled`, `expired` |
| `plan_name` | text | Human-readable plan name |
| `plan_price_cents` | integer | Price in cents |
| `plan_interval` | text | `month`, `3-months`, `6-months` |
| `renewal_period_start` | timestamptz | Current billing period start |
| `renewal_period_end` | timestamptz | Current billing period end |
| `cancel_at_period_end` | boolean | If true, cancels when period ends |
| `canceled_at` | timestamptz | When cancellation was requested |
| `created_at` | timestamptz | Auto |
| `updated_at` | timestamptz | Auto (trigger-maintained) |

---

### `phone_leads`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | Auto-generated |
| `phone` | text UNIQUE NOT NULL | E.164 format e.g. `+11234567890` |
| `converted` | boolean | `true` once they purchase |
| `converted_at` | timestamptz | When they converted |
| `created_at` | timestamptz | When they entered the quiz funnel |
| `updated_at` | timestamptz | Auto (trigger-maintained) |

> [!NOTE]
> The quiz also sends a `quiz_answers` field. If you want to persist that, add a `quiz_answers jsonb` column to this table.

---

### `sms_campaigns`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | Auto-generated |
| `campaign_type` | text | `non_converter` or `converter` |
| `step_number` | integer | Order within the campaign (1, 2, 3…) |
| `delay_hours` | numeric | Hours after base time to send |
| `message_template` | text | The SMS body text |
| `active` | boolean | Whether this step is live |
| `created_at` | timestamptz | Auto |
| `updated_at` | timestamptz | Auto |

**Unique constraint:** `(campaign_type, step_number)` — one step per position.

---

### `sms_log`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | Auto-generated |
| `phone_lead_id` | uuid FK → `phone_leads` | CASCADE delete |
| `campaign_id` | uuid FK → `sms_campaigns` | CASCADE delete |
| `phone` | text | Phone number at time of send |
| `message_body` | text | Actual SMS text sent |
| `status` | text | `sent`, `failed`, `pending` |
| `twilio_sid` | text | Twilio message SID (null if failed) |
| `sent_at` | timestamptz | When the SMS was dispatched |
| `created_at` | timestamptz | Auto |

**Unique constraint:** `(phone_lead_id, campaign_id)` — prevents duplicate sends.

---

## 9. Membership Lifecycle

```
User buys on Whop
        │
        │ Whop fires webhook → POST /api/whop-webhook
        │
        ▼
memberships row UPSERTED
  status = 'active' (or 'trialing')
  user_id = NULL (unless email match found in auth.users)
        │
        │ User signs in to dashboard.html
        │ GET /api/subscription called with JWT
        │
        ▼
  Lazy linking attempt:
  1. Match by user_id (if already linked) → done
  2. Match whop_user_email to auth user email → link
  3. Match phone (converted phone_lead) → link most recent unlinked membership
        │
        ▼
  Membership returned to dashboard
  User sees their plan & content
        │
        ├── User requests cancel → POST /api/cancel-subscription
        │     ↓ Whop API called → Whop webhook fires later
        │     ↓ status → 'canceling'
        │     ↓ At period end: Whop fires webhook → status → 'canceled'
        │
        └── Subscription expires naturally
              ↓ renewal_period_end passes
              ↓ /api/subscription auto-marks status = 'expired'
              ↓ Returns { subscription: null }
```

---

## 10. SMS Drip Campaign System

### How to set up campaigns

Insert rows into `sms_campaigns` in the Supabase dashboard:

```sql
-- Non-converter flow (lead hasn't bought yet)
INSERT INTO sms_campaigns (campaign_type, step_number, delay_hours, message_template, active)
VALUES
  ('non_converter', 1,  0,    'Hey! Thanks for taking our quiz 🌸 Here''s your personalized plan: [link]', true),
  ('non_converter', 2,  24,   'Still thinking? Here''s what members are saying... [testimonial]', true),
  ('non_converter', 3,  72,   'Last chance — grab your plan before the discount expires 👇 [link]', true);

-- Converter flow (lead bought — onboarding sequence)
INSERT INTO sms_campaigns (campaign_type, step_number, delay_hours, message_template, active)
VALUES
  ('converter', 1,  1,   'Welcome to SlimBloom! 🎉 Log in to access your workouts: [link]', true),
  ('converter', 2,  48,  'How are your first workouts going? We''re here if you need help!', true);
```

### How timing works

- **`send-sms` edge function** fires **immediately** on new phone lead INSERT → sends step 1 of `non_converter` after a 60-second delay.
- **`process-sms-queue`** runs **every hour** (cron). It calculates: `base_time + delay_hours > now()`. If so, it sends the SMS and logs it. Already-sent messages (tracked in `sms_log`) are skipped.

### Marking a lead as converted

When a user purchases, you should update `phone_leads`:
```sql
UPDATE phone_leads
SET converted = true, converted_at = now()
WHERE phone = '+11234567890';
```

This switches the lead from the `non_converter` drip to the `converter` drip on the next cron run.

> [!TIP]
> This update could be automated by adding logic to `/api/whop-webhook` — when a membership is created, look up `phone_leads` by email and mark it converted.

---

## 11. Authentication Flow

The app supports two authentication methods, both in Supabase Auth:

### Method A: Phone OTP (primary on mobile/quiz)
1. User enters phone number
2. `supabase.auth.signInWithOtp({ phone: '+1...' })` → Supabase sends SMS via Twilio (separate Twilio integration from the drip campaigns — this is Supabase's built-in OTP feature)
3. User enters 6-digit code
4. `supabase.auth.verifyOtp({ phone, token, type: 'sms' })` → session created
5. JWT stored in browser

### Method B: Email + Password (for desktop users / returning members)
1. `supabase.auth.signUp({ email, password })` — creates account
2. If already exists: `supabase.auth.signInWithPassword({ email, password })`
3. Password reset via `resetPasswordForEmail` → email sent with deep link

### Session handling (dashboard.html)
```js
_supabase.auth.getSession()       // Check for existing session on load
_supabase.auth.onAuthStateChange() // React to login/logout in real time
```

---

## 12. Row Level Security (RLS) Model

| Table | Authenticated User | Service Role |
|---|---|---|
| `memberships` | SELECT own rows only (`user_id = auth.uid()`) | Full access |
| `phone_leads` | No access (service role only) | Full access |
| `sms_campaigns` | SELECT all | Full access |
| `sms_log` | No access (service role only) | Full access |

**Key principle:** All write operations go through `/api/*` serverless routes that use the `SUPABASE_SERVICE_ROLE_KEY`, which **bypasses RLS entirely**. RLS only applies to direct client-side Supabase calls using the anon key.

> [!CAUTION]
> Never expose `SUPABASE_SERVICE_ROLE_KEY` to the browser. It is only used server-side in `/api/*.js` files.

The anon key in the HTML files is public and safe — it can only do what the RLS policies allow (read own membership, insert phone leads, read campaigns).

---

## 13. Environment Variables Reference

Set all of these in your **Vercel project settings** under Environment Variables.

### Required for API routes (Vercel)

| Variable | Description |
|---|---|
| `SUPABASE_URL` | Your Supabase project URL (e.g. `https://xxxx.supabase.co`) |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key — found in Supabase → Settings → API. **Never expose publicly.** |
| `WHOP_API_KEY` | Whop API key — used to call Whop's cancel endpoint |
| `WHOP_WEBHOOK_SECRET` | Whop webhook signing secret (Svix) — used to verify incoming webhooks |
| `ADMIN_EMAIL` | Email address of the admin user (gating `/admin` and `/api/save-workout-data`) |
| `GITHUB_TOKEN` | Personal access token with `contents:write` scope for the slimbloom repo |

### Required for Supabase Edge Functions

Set via `supabase secrets set` or the Supabase Dashboard → Edge Functions → Secrets:

| Variable | Description |
|---|---|
| `SUPABASE_URL` | Auto-available in edge functions (no manual set needed) |
| `SUPABASE_SERVICE_ROLE_KEY` | Auto-available in edge functions (no manual set needed) |
| `TWILIO_ACCOUNT_SID` | Twilio Account SID |
| `TWILIO_AUTH_TOKEN` | Twilio Auth Token |
| `TWILIO_PHONE_NUMBER` | Your Twilio phone number (E.164) |

### Client-side (hardcoded in HTML — safe to be public)

| Variable | In file | Description |
|---|---|---|
| `SUPABASE_URL` | All HTML files | Public Supabase project URL |
| `SUPABASE_ANON_KEY` | All HTML files | Public anon key — safe, governed by RLS |

---

## 14. Step-by-Step Setup Guide

### Prerequisites

- Node.js v18+
- Supabase CLI installed (`npm i -g supabase`)
- Vercel CLI installed (`npm i -g vercel`)
- A Supabase project created
- A Whop account with products/plans created
- A Twilio account with a phone number
- A GitHub personal access token

---

### Step 1: Clone and install

```bash
git clone https://github.com/Brennanmacneil/slimbloom.git
cd slimbloom
npm install
```

---

### Step 2: Apply the database migration

**Option A – Supabase CLI:**
```bash
supabase login
supabase link --project-ref <your-project-ref>
supabase db push
```

**Option B – SQL Editor:**
Paste the contents of `supabase/migrations/20240001000000_initial_schema.sql` into the Supabase Dashboard → SQL Editor → Run.

---

### Step 3: Configure Supabase Auth

In Supabase Dashboard → Authentication → Settings:

1. **Enable Phone provider** (uses Twilio) — enter your Twilio credentials
2. **Enable Email provider** — enable "Confirm email" or disable for frictionless sign-up
3. **Site URL:** `https://www.lazyweightloss.com`
4. **Redirect URLs:** Add `https://www.lazyweightloss.com/home`

---

### Step 4: Create Supabase Storage bucket

In Supabase Dashboard → Storage:
1. Create a **public bucket** named `quiz-images`
2. Upload the quiz images (age group photos, body diagram)
3. Update image URLs in `quiz.html` if your project ref differs

---

### Step 5: Deploy Supabase Edge Functions

```bash
supabase functions deploy send-sms
supabase functions deploy process-sms-queue

# Set secrets
supabase secrets set TWILIO_ACCOUNT_SID=ACxxxx
supabase secrets set TWILIO_AUTH_TOKEN=your_token
supabase secrets set TWILIO_PHONE_NUMBER=+1xxxxxxxxxx
```

---

### Step 6: Set up the Database Webhook (for `send-sms`)

In Supabase Dashboard → Database → Webhooks:
1. **Create webhook**
2. Table: `phone_leads`, Event: `INSERT`
3. Type: **Supabase Edge Function**
4. Function: `send-sms`

---

### Step 7: Set up the Cron Job (for `process-sms-queue`)

In Supabase Dashboard → Edge Functions → `process-sms-queue`:
1. Enable cron schedule
2. Set schedule: `0 * * * *` (every hour)
Or use Supabase's **pg_cron** extension:
```sql
select cron.schedule('process-sms-queue', '0 * * * *',
  $$select net.http_post(url := 'https://<project-ref>.supabase.co/functions/v1/process-sms-queue',
    headers := '{"Authorization": "Bearer <service-role-key>"}') as request_id;$$
);
```

---

### Step 8: Configure Whop Webhook

In your Whop dashboard → Developer → Webhooks:
1. **URL:** `https://www.lazyweightloss.com/api/whop-webhook`
2. **Events to send:** `membership.went_valid`, `membership.went_invalid`, `membership.updated`
3. **Copy the signing secret** → set `WHOP_WEBHOOK_SECRET` in Vercel

---

### Step 9: Set Vercel environment variables

```bash
vercel env add SUPABASE_URL
vercel env add SUPABASE_SERVICE_ROLE_KEY
vercel env add WHOP_API_KEY
vercel env add WHOP_WEBHOOK_SECRET
vercel env add ADMIN_EMAIL
vercel env add GITHUB_TOKEN
```

Or set them in the Vercel dashboard under Project → Settings → Environment Variables.

---

### Step 10: Update hardcoded values in HTML

In `dashboard.html`, `quiz.html`, and `admin.html`, update these values if your project changed:

```js
var SUPABASE_URL = 'https://YOUR-PROJECT-REF.supabase.co';
var SUPABASE_ANON_KEY = 'YOUR-ANON-KEY';
```

Both values are found in Supabase → Settings → API.

---

### Step 11: Seed the SMS campaigns

```sql
INSERT INTO public.sms_campaigns (campaign_type, step_number, delay_hours, message_template, active)
VALUES
  ('non_converter', 1, 0,   'Your welcome message here', true),
  ('non_converter', 2, 24,  'Follow-up message 24h later', true),
  ('converter',     1, 1,   'Welcome to the program! Access here: https://lazyweightloss.com/home', true);
```

---

### Step 12: Deploy to Vercel

```bash
vercel --prod
```

---

## 15. Common Gotchas & Notes

### Lazy membership linking
Memberships are created by the Whop webhook **before** the user has a Supabase account. The first time a user logs into the dashboard, `/api/subscription` links them automatically via email or phone match. This means a user can buy → receive content immediately via SMS → log in later and still see their plan.

### `quiz_answers` column
The quiz sends `quiz_answers: answers` when inserting into `phone_leads`, but this column is not in the current schema. If the insert fails silently, this is why. Fix with:
```sql
ALTER TABLE public.phone_leads ADD COLUMN quiz_answers jsonb;
```

### Coupon code is hardcoded
The `LAZY` coupon is hardcoded in `api/activate-coupon.js`. There is no DB-driven coupon system. To add new codes, edit that file and redeploy.

### Workout data lives in GitHub, not the DB
`workout-data.json` is the source of truth for all workout content. The admin panel writes to it via the GitHub API. The dashboard reads it directly from the deployed site (`/workout-data.json`). There is **no workout/exercise database table**.

### `whop_membership_id` is the upsert key
Every time a Whop webhook fires (renewal, cancellation, etc.) it hits the same row in `memberships`. The upsert is on `whop_membership_id`. Keep this column unique and non-null.

### The `canceling` status
When a user cancels, the local DB is immediately set to `canceling`. The final `canceled` status arrives later via a Whop webhook. During the `canceling` period, the user still has access (they're still within their paid period).

### Phone OTP vs. Twilio drip SMS — two separate Twilio accounts
Supabase Auth uses Twilio to send OTP codes for phone login. The drip campaigns use Twilio directly from the edge functions. These can be the **same** Twilio account/number, but they're configured separately (once in Supabase Auth settings, once via edge function secret).

### Admin check is email-based
There is no `is_admin` column in the database. The admin check is purely `user.email === ADMIN_EMAIL`. This is simple but means only one admin can exist.

### RLS + service role
All `/api/*` routes use `SUPABASE_SERVICE_ROLE_KEY` which bypasses RLS. Direct client-side queries (quiz inserting phone_leads, dashboard reading memberships) use the anon key and are governed by RLS. The current RLS policies allow:
- Anon users to INSERT into `phone_leads` (quiz phone capture)
- Authenticated users to SELECT their own membership row
