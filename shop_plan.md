# Shop Feature Plan

## Overview
A shop where users spend tokens (earned by attendance) to customize the font, color, and style of their name across the site.

---

## Scope: Medium-Large

---

## What Needs to Be Built

### Backend (Google Apps Script + Sheets)
- New `tokens` column or sheet tracking each user's balance
- Token award logic: calculate tokens from attendance records (on `add` action)
- New `shop` sheet or structured data for purchased items per user
- New API actions: `getTokens`, `spendTokens`, `getPurchases`

### Data Model
- Token balance per original name
- Purchased cosmetics per original name: `{ font, color, style }`
- Must persist server-side (Sheets), not just localStorage

### Frontend
- Shop UI window (new XP-style dialog) listing purchasable items with token costs
- Token balance display (stats window or toolbar)
- Cosmetic application: look up each user's purchased styles and apply them dynamically when rendering names
- Purchase confirmation flow

### Name Rendering Changes
- Currently names are rendered with static CSS
- Every place a name is shown (login grid buttons, stats grid, history table) needs to conditionally apply per-user inline styles

---

## Complexity Factors

| Factor | Notes |
|--------|-------|
| Token calculation | Retroactive from existing data, or forward-only? |
| Cosmetic scope | Fonts (Google Fonts?), colors (color picker?), styles (bold/italic/etc.) |
| Persistence | Must be server-side (Sheets) — localStorage alone won't work across devices |
| Apps Script limits | Reads/writes are slow; each shop action is a round-trip |
| Single-file architecture | All new UI/JS goes into the already-1136-line `index.html` |

---

## Rough Effort

| Area | Estimate |
|------|----------|
| Backend (Apps Script) | ~150–200 lines |
| Frontend UI (shop window + token display) | ~200–300 lines |
| Name rendering refactor (5–8 touch points) | ~50–100 lines |
| **Total** | **~400–500 lines** new/modified code |

---

## Key Design Decisions (to resolve before implementing)
1. **Token calculation**: retroactive vs. forward-only?
2. **Cosmetic catalog**: fixed set of options vs. open-ended (color picker, font selector)?
3. **Token cost balancing**: how many tokens per attendance session, and how much do items cost?
