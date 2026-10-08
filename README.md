<p align="center"><img src="client/public/og-image.png" alt="YumFindAI: where to eat, picked from fresh reviews" width="840"></p>

# YumFindAI

**An AI agent that finds where to eat by reading what people said this month.**

Tell YumFindAI what you are craving. The agent decides for itself which Google data to pull through SerpApi: it searches Google Maps around you, reads the newest reviews for the strongest candidates, widens the radius or tries the local name of a dish when the evidence is thin, cross-checks local food blogs, and pulls driving times when you care about distance. Every step shows up live on the map while it works, and the final ranking only includes places whose reviews it actually read.

Built for the **SerpApi India Hackathon 2026** · Track: *AI Agents* (also fits *Travel & Local Discovery*).

---

## What makes it different from a maps app

| A maps app | YumFindAI |
| --- | --- |
| Shows every place matching a keyword | Ranks a short list from **evidence in reviews from the last 3 months** |
| Rating is a number | Verdict says *what reviewers said about your dish*, and says plainly when they did not mention it |
| One query, one list | An **agent loop**: search → read → judge → widen / re-query / cross-check → finish |
| Opaque | A **live trace** of every SerpApi call the agent chose to make, and a "How YumFindAI decided" log afterwards |
| Follow-ups start over | "Which is closest by road and good for a family?" is answered from cached reviews, fetching directions or more reviews only when needed |

## How the agent works

```
craving + location + radius + preferences
        │
        ▼
 ┌─────────────────────────── Gemini (function calling) ───────────────────────────┐
 │ decides the next tool, writes a one-line "why" the user sees, loops ≤10 turns   │
 │                                                                                  │
 │   search_places   → SerpApi engine=google_maps                                   │
 │   read_reviews    → SerpApi engine=google_maps_reviews (newest first, pageable)  │
 │   web_search      → SerpApi engine=google                                        │
 │   get_directions  → SerpApi engine=google_maps_directions                        │
 │   finish          → ranked places + per-place verdict + review-support score     │
 └──────────────────────────────────────────────────────────────────────────────────┘
        │  events stream to the browser as newline-delimited JSON
        ▼
 map: candidate pins drop as they are found → live step list → ranked cards
```

Guard rails the agent runs under:

- A **SerpApi budget per search** (12 calls; 4 for a follow-up). When it runs out, tools return a "budget used up" message and the agent must finish with what it has.
- **No invented facts.** The agent can only rank `place_id`s that came back from `search_places` and whose reviews it read. Verdicts are written from those review snippets; the prompt requires it to say when reviews do not mention the dish.
- **Deterministic fallback.** If Gemini is unavailable, the server runs the same plan itself (search → read reviews for the top five → rank by rating and distance) and labels the result as rating-only.
- **Topic gate.** Non-food requests are refused before any SerpApi call.
- **Shared cache** in Supabase: same area + craving + constraints within 6 hours returns instantly without calling SerpApi; reviews are kept per place for 7 days.

## Meet the mascot

<img src="client/public/brand/yumfindai-mascot.png" alt="The YumFindAI mascot, a map pin with a steamed-bun face" width="120" align="right">

YumFindAI's mascot is a map pin (*find*) with a steamed-bun face (*yum*). The same drawing is the logo mark and the favicon. It is one SVG component ([`client/src/components/mascot/art.tsx`](client/src/components/mascot/art.tsx)), so it stays sharp at every size and reacts to the app instead of being a static picture:

| What is happening | What the mascot does |
| --- | --- |
| Agent calls `google_maps` | holds a magnifying glass over one eye |
| Agent calls `google_maps_reviews` | reads a little review card |
| Agent calls `google` or `google_maps_directions` | looks up and thinks |
| Results arrive | cheers |
| You type a craving or an email | watches the text cursor |
| You type a password | covers its eyes |
| Mic is listening | listens |
| Something fails | looks worried |

It also blinks, follows the pointer, cheers up when hovered and hops when tapped. All motion is translate/scale only and turns off for `prefers-reduced-motion`. Static brand files (logo, mark, mascot, icons, banner) are in [`client/public/brand`](client/public/brand) and [`client/public`](client/public).

## SerpApi usage

All SerpApi calls are made server-side in [`server/src/serp.ts`](server/src/serp.ts) with `google_domain=google.co.in`, `gl=in`, `hl=en`. The agent in [`server/src/agent.ts`](server/src/agent.ts) chooses when to call each one.

| Engine | Used for | Notable parameters |
| --- | --- | --- |
| `google_maps` (`type=search`) | Finding open restaurants for the craving near the user; the agent re-calls it with a wider `m` or a different `q` when results are thin | `lat`, `lon`, `m` (radius in metres), `nearby=true`, `open_state=now`, optional `min_rating`, `json_restrictor` to trim the payload |
| `google_maps_reviews` | Reading the newest reviews for shortlisted places; the agent can page deeper for one place when the dish is not mentioned yet | `data_id` / `place_id`, `sort_by=newestFirst`, `next_page_token` (resumable pagination, reviews older than 90 days are dropped) |
| `google` (organic) | Cross-checking candidates against local food blogs and "best X in <area>" lists, or finding the local name of a dish | `q`, `num=8`, `json_restrictor=organic_results[].{title,link,snippet}` |
| `google_maps_directions` | Driving time and distance to a place when the user cares about speed or closeness; also draws the route on the map | `start_coords`, `end_coords`, `travel_mode=0` |

Also used outside the agent: `google_maps` with `q=restaurants` for the initial "nearby dots" snapshot (`/api/nearby`).

No SerpApi key ever reaches the browser. SerpApi's own one-hour cache is left on.

## Stack

- **Client:** Vite, React 19, TypeScript, Tailwind v4, MapLibre GL (OpenFreeMap tiles), Supabase Auth.
- **Server:** Node 20+, Hono, TypeScript. Streams agent events over `application/x-ndjson`.
- **Agent model:** Gemini (`gemini-3.8-flash` by default) via the REST API with function calling. Gemini also writes the review verdicts and runs the topic gate. Gemini embeddings are stored in pgvector for review retrieval.
- **Data:** Supabase Postgres + pgvector with row-level security. Shared tables for places, reviews, review chunks and search snapshots; per-user tables for searches and visits.
- **Reverse geocoding** of the user's position uses OpenStreetMap Nominatim (no key).

## Run it locally

Prerequisites: Node 20 or newer, a Supabase project, a SerpApi key, a Gemini API key.

1. **Database.** In the Supabase SQL editor run [`supabase/migrations/20261006103000_init.sql`](supabase/migrations/20261006103000_init.sql). It creates the tables, RLS policies, the `vector` extension and the signup trigger.
2. **Environment.** Copy `.env.example` to `.env` in the repo root and fill in:

   ```
   SUPABASE_URL=https://<project>.supabase.co
   SUPABASE_PUBLISHABLE_KEY=<anon/publishable key>
   SUPABASE_SERVICE_ROLE_KEY=<service role key>      # server only
   SERPAPI_API_KEY=<serpapi key>                     # server only
   GEMINI_API_KEY=<gemini key>                       # server only
   GEMINI_MODEL=gemini-3.8-flash
   GEMINI_EMBED_MODEL=gemini-embedding-001
   VITE_SUPABASE_URL=https://<project>.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=<anon/publishable key>
   ```

   `TYPESAFE_AI_API_KEY` / `JEV_MODEL` are optional and currently unused (an earlier ranking model, kept for reference in `server/src/jev.ts`).

3. **Install and start.**

   ```
   npm install
   npm install --prefix server
   npm install --prefix client
   npm run dev
   ```

   The API listens on `http://127.0.0.1:8787`, the app on `http://localhost:5173` (Vite proxies `/api` to the server).

4. **Use it.** Sign up (email + password), open the map, tap **Locate me**, type a craving such as *chicken biryani*, pick a radius, press **Read reviews** and watch the agent work. Then try a follow-up like *which one is less spicy?* or *closest by road?*

`npm run typecheck` type-checks both halves.

## API

| Route | Purpose |
| --- | --- |
| `POST /api/agent/search` | Runs the search agent. Streams `{type:"step"}`, `{type:"places"}`, then `{type:"done", result}` as NDJSON. |
| `POST /api/agent/followup` | Runs the follow-up agent over an existing search (`fingerprint`). Same event stream. |
| `POST /api/nearby` | Nearby restaurant dots for a coordinate (no reviews). |
| `POST /api/directions` | Driving route for the map line. |
| `POST /api/where` | Human-readable place name for a coordinate. |
| `POST /api/visits` | Records that the user opened a place. |
| `POST /api/search`, `POST /api/followup` | The earlier non-agent pipeline, kept as a fallback. |

All routes except `/api/health` require a Supabase JWT.

## Project layout

```
client/src/pages/Dashboard.tsx   map, search flow, live agent trace, result cards
client/src/components/AgentTrace.tsx
client/src/components/MapCanvas.tsx
client/src/components/mascot/       the YumFindAI character: drawing, moods, motion
client/public/brand/                logo, mark and mascot as SVG and PNG
server/src/agent.ts              the agent loop, tools, prompts, budget, fallback
server/src/serp.ts               every SerpApi call
server/src/gemini.ts             Gemini REST client: function calling, JSON copy, embeddings, topic gate
server/src/store.ts              Supabase cache (places, reviews, snapshots, searches, visits)
server/src/pipeline.ts           nearby dots and the earlier fixed pipeline
supabase/migrations/             schema and RLS
```

## AI tools used in building this

Claude Code (Anthropic) was used as a coding assistant for the UI implementation and the agent loop; all code was reviewed and run by the author. Gemini is used at runtime as described above. The visual design was prototyped with Claude Design.
