# Barber-brone — Product & Engineering Prompt

> A self-service barbershop booking system delivered as a Telegram bot and Telegram Mini App. Replaces phone-call scheduling and notebook tracking with a fully automated platform that handles bookings, no-show recovery, walk-ins, breaks, and apprentice management — so the barber can focus on cutting hair.

## 1. Context & Goal

Independent barbershops still run on phone calls and a paper notebook. Every booking interrupts the barber mid-cut. When a client doesn't show up, slots sit empty because there's no way to notify the next clients. When a walk-in arrives, everyone behind gets pushed back manually and nobody is told.

**Goal:** Build a Telegram-native booking app that handles 100% of the scheduling logic — discovery, booking, confirmations, reminders, no-show recovery, walk-in absorption, break handling, and apprentice load-balancing — so the barber has zero administrative overhead during the workday.

**Why Telegram:** Highest trust + adoption in the target region (Uzbekistan / CIS). Telegram Mini Apps give a native-feeling installable UI with verified identity (`initData`) and one-tap contact sharing — no app store, no separate auth.

---

## 2. Roles

| Role | What they do | How they're identified |
|---|---|---|
| **Customer** | Books appointments; minimal friction; one-tap booking of the next free slot. | Telegram account + shared phone number. |
| **Main Barber (Admin)** | Runs the shop. Sees both timelines, manages settings, apprentices, finances. | Telegram user ID listed in `TELEGRAM_ADMIN_IDS` env var (first ID = Main Barber). |
| **Apprentice** | Independent barber with restricted view; sees only own queue. | Added by the admin in Settings → Apprentices (by Telegram ID). |

---

## 3. End-User Experience

### 3.1 Customer flow — every interaction is 1–3 taps

**Onboarding (one time):**
1. User opens the bot, taps `/start`.
2. Bot greets them and shows a single "📱 Share my phone number" button (Telegram contact-share).
3. After phone is shared, bot sends an inline button "Book a haircut" that opens the Mini App.

**Landing screen (recurring):**
- Header: shop name + page title.
- **Barber selector** (only shown if ≥2 active barbers): segmented control toggling Main vs Apprentice, with role labels visible.
- **Hero CTA:** a large gradient card showing the *next available time* (e.g. `14:30`) for the selected barber. Tapping books straight into Configure.
- **Secondary CTA:** "📅 Book a different time" — expands to an inline grid of every available 15-minute start time for any chosen date.

**Configure screen** (after time is chosen):
- Top: back arrow, page title, picked slot time.
- **Live total card** (gradient): updates instantly as the customer toggles things. Shows `{estimated total}` and `{duration}`. Animates on every change.
- **Services list:**
  - The relevant haircut row (adult/child) is rendered as a *locked* card with a lock icon. It cannot be unchecked. Subtitle: "Required — one per adult/child".
  - Optional services (Hair wash, Beard cut) are tappable cards with a check icon. Springy press feedback + Telegram selection haptic.
- **Party size:**
  - Adults stepper, default **1**, can go to 0 (only if at least one child).
  - Children stepper, default **0**.
  - Steppers use `− [N] +` shape with circular touch targets and a springy number animation on change.
- **Footer:** "Cancel" (left, ghost) + big primary **Book** button (right, fills remaining width).
- Error states (slot just taken, phone missing) render inline above the footer with destructive styling.

**Confirmation screen** (after a successful booking):
- A bouncy ✅ badge enters with a spring animation.
- "You're booked!" title + subtitle.
- A receipt card with: Time (large), Duration, Adults, Children, Extras, Total (highlighted).
- A pill toggle: 🔔 **Reminder ON** (default — 15-minute pre-appointment reminder) or 🔕 **Reminder OFF**. Tapping toggles persistently.
- Footer: a single full-width **Close** button. Closing the Mini App returns the customer to the chat.

### 3.2 Main Barber dashboard

**Layout:**
- Header (sticky): shop name (kicker), today's booking count, date picker, **settings gear** icon.
- **Barber switcher** (admin only, if ≥2 active barbers): segmented control to view any barber's timeline.
- **Main panel:** vertical timeline with a fixed 56-pixel left "time gutter" column displaying each row's start time, plus an arrow → end time underneath. The right column contains:
  - **Booking cards:** customer name, phone (tap-to-call), price, duration, party-size chips, extras chips. Card height is proportional to booking duration (configurable px-per-minute), so a 60-minute haircut visibly takes twice the vertical space of a 30-minute one.
  - **Gap rows:** dashed-outline strips showing free time ("20 min free").
  - **Block rows:** filled grey strip with icon (☕ break / 🚶 walk-in / 🚫 manual) and duration label.

**Gesture: swipe-left on a booking card**
- Springy drag with snap-to-reveal at threshold OR velocity-trigger.
- Reveals 1 or 2 action buttons on the right edge:
  - **Apprentice** (blue) — only if at least one *other* active barber exists. Instantly transfers the booking; backend checks the target's availability for that slot.
  - **Discard** (red) — marks the booking as `DISCARDED_NO_SHOW` and runs Smart Shift Earlier.
- Tap the card body after reveal → snaps closed.
- Both actions trigger haptics (warning/success) and notify the customer.

**Bottom button: Take a Break / Walk-in**
- Long, thin, dark, sticky button at the bottom of the screen. Spec calls for "take a break" — same UI handles walk-ins (the barber picks which it is in the sheet).
- Tapping it opens a bottom sheet:
  1. **Type:** Break ☕ / Walk-in 🚶 segmented control.
  2. **Duration:** preset chips 15 / 30 / 45 / 60 / 90 min.
  3. **Preview impact** button (dark) — runs a server-side dry-run.
  4. Sheet shows:
     - 🟢 No conflicts → single **Confirm block** button.
     - 🟠 Overlapping clients → list them by time. If the suggested transfer target (first other active barber) is free for *all* overlapping bookings, show a green "Apprentice free" pill. Otherwise a grey "Apprentice busy".
     - Two action buttons: **Shift N client(s) later** (always available) and **Transfer to {ApprenticeName}** (only enabled when the apprentice is free for every conflict).
- After commit, affected clients receive Telegram messages: "Your appointment moved from HH:MM to HH:MM" or "Your appointment was moved from Main Barber to Apprentice".

### 3.3 Apprentice dashboard

Identical to the Main Barber dashboard but:
- The barber-switcher header control is hidden — they only see their own day.
- The "Apprentice" transfer action on cards is hidden (they're the apprentice).
- The gear icon is hidden (no admin scope).
- They retain swipe-Discard and Take-a-Break.

### 3.4 Settings (admin only)

Accessible via the gear icon. Top-level list:

1. **Apprentices** — list with status badges. Each row has Block-out times / Activate / Deactivate / Delete buttons.
   - **Add apprentice** sheet: numeric Telegram ID input + display name. Tip linking to `@userinfobot`.
   - **Block-out** sheet: HH:MM From / HH:MM To for today. Submitting calls the same smart-shift logic so any conflicting clients are pushed later.
2. **Services & pricing** — 4 default services (adult haircut, child haircut, wash, beard). Each row has stepper inputs for **Price (UZS)** (step 1000) and **Duration (min)** (step 5), an activate toggle, and a Save button that lights up only when dirty.
3. **Client database** — searchable list of every user the bot has ever seen. Search hits firstName, lastName, username, phone. Role badge shown.
4. **Finances** — From/To date pickers, a gradient hero card with total revenue and booking count, plus a per-barber breakdown with horizontal bar chart of revenue share.

---

## 4. Smart Scheduling Rules

The platform's reason to exist. All three rules run server-side, atomically, and notify affected customers via the Telegram bot.

### 4.1 Booking duration

```
total_duration = adults × adult_haircut_minutes
               + children × child_haircut_minutes
               + (wash? add wash_minutes)
               + (beard? add beard_minutes)

total_price    = adults × adult_haircut_price
               + children × child_haircut_price
               + (wash? add wash_price)
               + (beard? add beard_price)
```

Haircuts scale with party size; optional add-ons are flat (one wash per session, not per person).

### 4.2 Smart Shift Earlier — *triggered by no-show discard*

When a booking `B` at time `T` is marked as no-show:
1. Mark `B` as `DISCARDED_NO_SHOW`.
2. Walk every later `SCHEDULED` booking of the same barber that day in start-time order.
3. For each, compute its earliest valid position: at or after the previous moved booking's end, after any time-block, never before the original start of the discarded slot.
4. If the new position is strictly earlier than the current start, update the row.
5. For each shifted booking, send Telegram: *"🎉 Good news! A slot opened earlier — your appointment moved from {old} to {new}. You can come in earlier."*

### 4.3 Smart Shift Later — *triggered by Take-a-Break with mode=shift*

When inserting a new block `[blockStart, blockEnd)`:
1. Find every `SCHEDULED` booking whose end is after `blockStart`.
2. Walk in order. For each, push start to `max(currentStart, prevPlacedEnd, blockEnd)`; advance past any other block.
3. If a placement would push the booking past closing time, flag it as **unplaceable** (the UI offers transfer-to-apprentice instead).
4. Commit all shifts in a single transaction; create the block.
5. For each shifted booking, send Telegram: *"🙏 Schedule update — your appointment moved from {old} to {new}. Sorry for the change!"*

### 4.4 Bulk Transfer — *triggered by Take-a-Break with mode=transfer*

1. Find every booking overlapping `[blockStart, blockEnd)`.
2. For each, check if `toBarberId` is free for that booking's exact slot (no overlap with their own bookings/blocks).
3. If yes, update `booking.barberId = toBarberId` and notify customer.
4. Refused bookings (apprentice busy) are reported back to the barber to manually resolve.
5. Create the block on the original barber.

### 4.5 Reminders

Cron tick every minute. Finds bookings whose `startAt - reminderLeadMin ± 30s` window matches now and `reminderSentAt IS NULL` and `remindersOn = true`. Sends Telegram message, marks `reminderSentAt`.

---

## 5. Technical Architecture

### 5.1 Stack

| Layer | Choice | Why |
|---|---|---|
| Backend runtime | Node.js 20+, TypeScript, ES modules | Mature TS toolchain; ESM is the future. |
| Bot framework | [grammY](https://grammy.dev) | Cleaner than telegraf for TS, first-class webhook + long-polling support. |
| HTTP framework | Fastify 4 | Fast, schema-friendly, native TS types. |
| ORM | Prisma | First-class Postgres migrations; type-safe queries; great DX. |
| Database | PostgreSQL 16+ | Transactional integrity for atomic shifts; no surprises with timezones. |
| Frontend | React 18 + Vite 5 | Fast HMR; Vite proxy makes /api seamless in dev. |
| Styling | Tailwind 3 with CSS variables for Telegram theme | Theme tokens (`--tg-bg`, `--tg-text`, etc.) re-mapped at runtime from `Telegram.WebApp.themeParams`. |
| Motion | Framer Motion 11 | Required for the swipe-to-reveal gesture; powers sheet, spring buttons, card transitions. |
| Validation | Zod | Single source of truth for env + request schemas. |
| Cron | node-cron | One-minute ticks; trivially replaceable later. |
| Deploy | Linux VPS, PM2, Nginx, Docker for Postgres | Standard, cheap, no vendor lock-in. |

### 5.2 Authentication

- **Mini App requests:** every API call carries `Authorization: tma {initData}`. The backend validates the HMAC against `TELEGRAM_BOT_TOKEN` per [Telegram's spec](https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app), rejects if older than 24 h. The validated `user.id` upserts the local `User` row.
- **Authorization:** environment-listed Telegram IDs are auto-promoted to `ADMIN` on first authenticated request; apprentices are added explicitly via the admin endpoint, which sets `role=APPRENTICE` and creates a `Barber` row.
- **Bot:** webhook in prod (`TELEGRAM_WEBHOOK_URL` + secret token), long-polling in dev.

### 5.3 Data model (Prisma)

```
User      ─< Booking >─ Barber
                       └─< TimeBlock
                       └─ user (1-1)
Service              # singleton catalog of haircut/wash/beard, mutable price + duration
Settings (singleton) # shopName, timezone, currency, openHourMin, closeHourMin, reminderLeadMin
```

- `User.role` ∈ {CUSTOMER, ADMIN, APPRENTICE}. `Barber.role` ∈ {MAIN, APPRENTICE}. A `User` with `Barber` profile is staff.
- `Booking.status` ∈ {SCHEDULED, COMPLETED, CANCELLED_BY_USER, DISCARDED_NO_SHOW, TRANSFERRED}. Storage in UTC; display in `Settings.timezone` (Asia/Tashkent default).
- `Booking.services String[]` stores the canonical key list (`haircut_adult`, `wash`, …) for reconstruction in analytics.

### 5.4 HTTP API surface

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/healthz` | none | Liveness |
| GET | `/api/me` | TMA | Current user + barber profile + shop settings |
| GET | `/api/barbers` | TMA | Active barbers |
| GET | `/api/services` | TMA | Active services |
| GET | `/api/availability/next` | TMA | Next bookable slot for a barber + selection |
| GET | `/api/availability/day` | TMA | Every 15-min slot for a barber on a date |
| POST | `/api/bookings` | TMA | Create booking; rejects if slot taken or phone missing |
| GET | `/api/bookings/mine` | TMA | Current user's upcoming bookings |
| PATCH | `/api/bookings/:id/reminders` | TMA (own) | Toggle reminder |
| DELETE | `/api/bookings/:id` | TMA (own) | Cancel booking |
| GET | `/api/bookings/day` | Staff | Day's bookings + blocks for a barber |
| POST | `/api/bookings/:id/discard` | Staff | No-show → Smart Shift Earlier + notify |
| POST | `/api/bookings/:id/transfer` | Staff | Transfer single booking to another barber |
| POST | `/api/blocks` | Staff | Insert block; `mode` ∈ {dry_run, shift, transfer} |
| DELETE | `/api/blocks/:id` | Staff | Remove block |
| GET | `/api/admin/apprentices` | Admin | List apprentices |
| POST | `/api/admin/apprentices` | Admin | Add (telegramId + displayName) |
| PATCH | `/api/admin/apprentices/:id` | Admin | Activate / deactivate / rename |
| DELETE | `/api/admin/apprentices/:id` | Admin | Remove |
| PUT | `/api/admin/services/:id` | Admin | Update price / duration / active |
| GET | `/api/admin/users` | Admin | Client database (with search) |
| PUT | `/api/admin/settings` | Admin | Shop settings |
| GET | `/api/admin/finances/summary` | Admin | Revenue grouped by barber/status |
| POST | `/telegram/webhook` | bot secret | Bot updates in prod |

### 5.5 Non-functional requirements

- **Atomicity:** Smart shifts must commit in a single transaction. The booking-discard endpoint must mark the booking *before* planning so the planner doesn't reorder onto its own slot.
- **Idempotency:** A double-tapped Discard or Transfer should be harmless (no duplicate notifications). Achieved by status guards.
- **Latency:** API responses for the Dashboard's day query target < 100 ms p95 on a single VPS.
- **Reliability:** A failed Telegram message to one user must not block notifications to others (each `safeSend` swallows errors and logs them).
- **Privacy:** Phone numbers stored at rest; never logged. The bot only shares phones with staff (booking cards on dashboard).
- **Internationalization:** UI English at MVP; user-facing strings centralised for future Uzbek/Russian translation.
- **Accessibility:** Minimum 44×44 px touch targets. Buttons announce loading state. Haptics are advisory, never required for completion.

---

## 6. UI/UX Principles (the polish layer)

1. **Tap targets are always 44 px+.** Steppers, sheet handles, swipe drawer buttons — all sized for thumbs.
2. **High contrast at all times.** Surface tokens (`--surface-1`, `--surface-2`) are computed via `color-mix(in srgb, var(--tg-text) X%, var(--tg-bg))` so cards always have visible elevation against the Telegram background, on any client theme. Borders use a `line-strong` token (18% mix of text on transparent) — never plain `--tg-secondary` which would vanish on light themes.
3. **Springs over linear.** Every press is a `scale: 0.97` with `spring(stiffness=380, damping=24)`. Sheets enter with `spring(stiffness=320, damping=32)` and a backdrop fade. Card swipes use velocity-aware snap.
4. **Haptics are deliberate.** Selection on toggles, light on small steps, medium on irreversible-but-fixable (book, take break), warning on destructive (discard), success on commit, error on failures.
5. **Always show the "why".** Configure shows duration AND total live. Take-a-Break shows exactly which clients will be affected and whether transfer is even possible — *before* asking for confirmation.
6. **Empty states have personality.** No bookings → 🪑 "The day is wide open." No apprentices → ✂️ + actionable Add button. No matches in client search → 📭.
7. **Loading skeletons over spinners** for content with predictable shape (`.shimmer` utility) — feels faster.

---

## 7. Project Structure

```
.
├── apps/
│   ├── backend/
│   │   ├── prisma/                  # schema.prisma, seed.ts, migrations/
│   │   └── src/
│   │       ├── index.ts             # Entry: builds Fastify, starts bot, kicks off cron
│   │       ├── api/
│   │       │   ├── index.ts         # Fastify app factory + CORS + routes
│   │       │   ├── auth.ts          # requireAuth / requireStaff / requireAdmin
│   │       │   ├── serializers.ts   # DTO shapers
│   │       │   └── routes/          # me, catalog, availability, bookings, blocks, admin
│   │       ├── bot/
│   │       │   └── index.ts         # grammY commands + contact handling
│   │       ├── lib/
│   │       │   ├── env.ts           # Zod-validated environment
│   │       │   ├── prisma.ts        # client singleton
│   │       │   ├── telegram-auth.ts # HMAC validator for initData
│   │       │   ├── time.ts          # Asia/Tashkent helpers
│   │       │   └── money.ts
│   │       └── services/
│   │           ├── pricing.ts       # quote() — total + duration
│   │           ├── availability.ts  # next-slot search, day slots
│   │           ├── smart-shift.ts   # planShiftEarlier / planShiftLater / applyMoves
│   │           ├── notify.ts        # safe Telegram sendMessage wrappers
│   │           └── reminders.ts     # 1-min cron
│   └── webapp/
│       └── src/
│           ├── main.tsx, App.tsx, styles.css
│           ├── state/BookingDraft.tsx   # cross-page draft for customer flow
│           ├── lib/                     # api, telegram, format, pricing
│           ├── hooks/useApi.ts          # tiny fetcher hook
│           ├── components/              # BarberSelector, NextSlotButton, PartyStepper,
│           │                            # ServiceCheckboxes, Timeline, ClientCard,
│           │                            # TakeBreakButton, PageHeader, ui/{Button,Sheet,Card}
│           └── pages/                   # Landing, Configure, Confirmation, Dashboard,
│                                        # Settings, settings/{Apprentices, Services,
│                                        # Clients, Finances}
├── docker-compose.yml                   # Postgres 16
├── nginx.conf.example                   # SPA + /api proxy + /telegram/webhook
├── ecosystem.config.js                  # PM2 for the backend
└── README.md
```

---

## 8. Acceptance Checklist (per role)

**Customer**
- [ ] Can `/start` the bot, share phone, and open the Mini App in one chain.
- [ ] Sees the next available slot within ≤ 1 second of the landing screen.
- [ ] Can book the suggested slot in two taps (CTA → Book).
- [ ] Can pick any future date and see every available start time.
- [ ] Sees live total + duration updating as they toggle services/party size.
- [ ] The haircut row is visibly locked and tells them why.
- [ ] Gets a Telegram confirmation message immediately after booking.
- [ ] Receives a Telegram reminder 15 minutes before the slot, unless they tapped Reminder OFF.
- [ ] If their booking gets shifted by smart logic, they receive a Telegram message naming the new time.

**Main Barber**
- [ ] On `/start`, the bot automatically gives them admin access (their Telegram ID is in env).
- [ ] Sees today's bookings as a scrollable timeline with a left time gutter.
- [ ] Card heights visibly scale with duration.
- [ ] Swipe-left reveals Discard and Apprentice actions.
- [ ] Discard → all later bookings slide earlier and customers are notified.
- [ ] Take-a-Break with conflicts → can choose Shift OR Transfer (when apprentice is free).
- [ ] Settings → Apprentices: can add by Telegram ID, deactivate, delete, block-out today's times.
- [ ] Settings → Services: can change price + duration; the customer's live total reflects new values on next open.
- [ ] Settings → Finances: revenue and booking counts shown for any date range.

**Apprentice**
- [ ] Sees only their own day; no barber switcher; no settings gear.
- [ ] Can swipe-Discard no-shows; gets smart-shift on their own queue.
- [ ] Can Take-a-Break; gets the same shift-vs-transfer choice if applicable.

---

## 9. Future / Out of Scope (MVP)

- Multi-day calendar view (current dashboard is single-day).
- Online payment / deposits.
- Photo gallery of haircut styles.
- Loyalty / repeat-customer discounts.
- Reviews & ratings.
- SMS fallback for users without Telegram.
- Multiple shop locations under one admin.
- Localization beyond English (Uzbek, Russian planned).

---

## 10. Environment

Required environment variables (see `apps/backend/.env.example`):

```ini
NODE_ENV=development
PORT=3000

DATABASE_URL=postgresql://user:pass@host:5432/barber_brone?schema=public

TELEGRAM_BOT_TOKEN=<from @BotFather>
TELEGRAM_ADMIN_IDS=<comma-separated Telegram user IDs; first = Main Barber>
WEBAPP_URL=https://your-public-url.example.com

# Production webhook (leave empty for long-polling in dev)
TELEGRAM_WEBHOOK_URL=
TELEGRAM_WEBHOOK_SECRET=

SHOP_TIMEZONE=Asia/Tashkent
SHOP_CURRENCY=UZS
CORS_EXTRA_ORIGINS=http://localhost:5173
```

---

## 11. Voice Scheduling (2026-05) & Deployment Strategies

A barber-facing **voice-note scheduling** capability: the barber sends a Telegram voice note in Uzbek/Russian; it is transcribed, parsed into a structured scheduling action, shown as a **Confirm/Cancel** card, and committed only on confirmation. The barber is also DMed shortly before each upcoming client.

**Pipeline:** voice `.ogg` → ffmpeg (16 kHz mono float32 WAV) → **faster-whisper** (STT) → **Ollama / Gemma 4 `gemma4:e4b`** (strict JSON tool call, temperature 0, schema-constrained, one corrective retry) → Node confirm card → on confirm, Node scheduling logic writes Postgres.

**Two locked decisions (from this session's research):**
- **Python is a stateless AI worker** — it never touches the DB. The Node bot owns Postgres + scheduling rules + the commit (avoids Prisma `cuid()`/`updatedAt` pitfalls; keeps business logic in one place).
- **Confirm-before-commit** on every voice action (Uzbek↔Russian ASR + a 4B model can mis-hear; nothing is written until ✅).

**Voice tools:** `add_client` (barber dictates a phone → `Client`, phone-only allowed) · `create_break` ("busy 13:00–14:00", not a client → `Block` BREAK) · `add_walkin` ("client now / at 15:00" → walk-in `Appointment`).

**Three independent, zero-shared-code deployment strategies** live at the repo root (each copy-paste deployable on its own):

| Project | Topology | Input | Notes |
|---|---|---|---|
| `project-1-monolithic-cloud-ai/` | one box: Postgres + Node bot + Python AI sidecar + Ollama | voice | localhost AI; 8 GB tight (16 GB comfortable) |
| `project-2-hybrid-distributed-ai/` | cloud bot (2 GB VPS) + local AI worker (Pi 5/PC) over a secure tunnel | voice | `X-Worker-Secret` auth; audio stays on your hardware |
| `project-3-standard-crud/` | one box: Postgres + Node bot | text commands + inline-keyboard wizards | **no AI / no Python** |

Full decision guide and run steps: **[VOICE-SCHEDULING.md](VOICE-SCHEDULING.md)**. These are standalone reference projects, **separate** from the main Mini App platform below.

**Caveats:** Ollama exposes no audio input (undocumented workaround has an open crash bug), so audio is handled by Whisper and Ollama only does the text→tool-call step. Uzbek/Russian code-switching is the main accuracy risk — the Confirm step is the safety net; validate on real barber audio before unattended use.

**Integrated into the main app (2026-05-31).** Voice now also runs inside the main bot (`apps/backend`), reusing the existing booking/break/smart-shift/notify services — so a voice action behaves exactly like the webapp/dashboard. It is **role-aware**: ADMIN/APPRENTICE → `create_break` + `add_walkin` on their own day; everyone else → `book_appointment` (next free slot or a stated time, with the MAIN barber + default haircut). Every action shows a **Confirm** card in the user's language (UZ/RU/EN). Files: `bot/voice.ts`, `ai/voice-client.ts`, `services/voice-actions.ts`, `voice.*` i18n keys, and `AI_SERVICE_URL` / `AI_REQUEST_TIMEOUT_MS` (default 180 s — CPU Gemma inference is ~60 s/note) in `lib/env.ts`. The Python AI sidecar is the same service as Project 1, extended with a `?role=` query param (`customer|staff|barber`, default `barber` keeps Project 1 unchanged) and the `book_appointment` tool.

**Project 4 — direct voice→Gemma, no Whisper (`project-4-direct-gemma-audio/`).** Whisper `small` badly mis-transcribed real Uzbek (it detected Kazakh/Korean/Turkish and returned gibberish). This variant skips STT entirely: the WAV is base64-encoded into Ollama's `images[]` field on `/api/chat`, and `gemma4:e4b` returns the tool call **and** a transcript in one request. Verified on Ollama 0.24.0: audio input *and* `format`-constrained tool-calling work together. The **live main-app AI service now runs this direct-Gemma variant** on `:8000`, so the bot understands Uzbek far better. Trade-off: this audio path is officially undocumented (intermittent crash risk per ollama#15333) — fallback is Whisper `large-v3` with a forced `uz`/`ru` language.

**Full voice command set (2026-05-31).** Customers: `book_appointment`, `cancel_booking`. Barbers/apprentices: `create_break` (any day — dates accept today/tomorrow/weekday/YYYY-MM-DD via a `today` anchor passed to the model), `cancel_break`, `add_walkin`, `cancel_booking`, `make_announcement` (broadcast to all customers), `update_service` (price/duration), `update_hours`, `add_vacation` (day off). Every action shows a Confirm card; cancellations reuse smart-shift-earlier + notify the affected customer.

**On/off control.** Deploy-time: `VOICE_ENABLED` env on the backend — set `false` to run the original bot with no Python/Ollama dependency (the voice handler isn't even registered). Runtime, per shop: the operator bot's `/voice <slug> on|off` flips `Settings.hasVoiceFeature` (checked inside the handler), so a shop's voice assistant can be toggled with no redeploy — mirroring the existing `/apprentice` toggle.

## 12. Platform features shipped beyond this MVP spec

Sections 1–10 describe the original MVP core (still accurate for the customer/barber Mini App). The shipped product has since grown well beyond it — **treat the codebase as the source of truth**; key additions:

- **Operator / fleet bot** (`apps/barber-dev`) — multi-tenant SaaS control: shop registry, monthly fees + billing crons, remote feature flags, cross-DB revenue. One per VPS.
- **Full i18n** — UZ / RU / EN (UZ default), switched via the bot `/language` command.
- **Vacation days** (shop-wide closures, availability-aware), **Announcements** (text + photo broadcasts with `file_id` reuse), **custom haircut styles** + service categories (HAIRCUT_ADULT/CHILD/ADDON + isDefault), **My Bookings** (customer self-service: list / cancel / reschedule), **shop location + GPS** (`/location` → pin-accurate Maps links), **apprentice feature gate** (toggled by the operator bot), **Finances** dashboard.
- **Smart Shift Earlier** now stops at the first gap > 30 min so distant bookings stay put; customer-cancel also triggers it.
- **Deployment:** AWS Lightsail + PM2 + nginx + Cloudflare Tunnel; see `DEPLOY.md` and `scripts/`.

---

*This document is the canonical spec. Any change in behaviour should land here first, then in the codebase.*
