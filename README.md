# NationStates Dossier Explorer

A static web application that queries the [public NationStates API](https://www.nationstates.net/pages/api.html) live from the browser and renders a full dossier for any **nation**, **region** or the **world**: blue title bars, bordered profile boxes, striped tables — plus charts for everything that benefits from them.

No backend is required to view dossiers: the page is plain HTML + CSS + JS served as static files. The only server-side pieces are two small Vercel serverless functions used for the economy report's region-wide export totals and for maintaining the ideology "example nation" pools.

Live at **https://nationstates-dossier-explorer.vercel.app/**

### This site was mostly vibe-coded
---

## Features

### 1. Lookup — nation, region or world
The home page has a search bar with three tabs. Type any nation or region name (case and spaces don't matter: `United States` and `united_states` are the same) and open its dossier. The **World** tab opens the global dossier with world averages. Every API request goes through a single queue that spaces calls at least ~700 ms apart and backs off on rate-limit responses, so heavy browsing stays within the NationStates limits.

### 2. Nation dossier
A complete registration-file style report:
- Flag, World Assembly membership, government type (game category), motto, animal, currency, demographics.
- Full registration file: region, founded date, first/last login/last activity, population, capital, leader, religion, currency, demonym, major industry, top spending priority, tax rate, GDP, average income, poorest/richest income, crime-level blurb.
- Government description and notable traits.
- Legislation & civil society: generated headlines and distinguishing traits.
- Government spending breakdown (budget shares) as a chart.
- Economic structure: split of black market / private industry / state industry.
- Leading causes of death (donut chart).
- World Assembly card: endorsements, influence.
- Adopted policies list.
- Recent activity log and official dispatches.

### 3. Political compass & ideology
Every entity is placed on a two-axis political compass (economic left-right × authority-freedom) computed from the World Census:
- The **X axis (economy)** is derived from the production split (private/black-market vs state-owned) when available, falling back to Economic Freedom.
- The **Y axis (authority)** is derived from Civil Rights and Political Freedom, adjusted for Government Size.
- The entity is then matched against **60 named ideologies**, each with an anchor position, expected *traditionalism* and *radicality* (society-profile dimensions), and optional **census requirements** (definitional gates such as "must actually be pacifist" for Anarcho-Pacifism) and **preferred profiles** (soft tie-breakers such as welfare for Social Democracy).
- The dossier explains the label in plain language: which data drove the classification, which ideologies were vetoed and why, how far the entity is from each rival anchor, and what budget priorities and policies corroborate it.

### 4. Political compass over time (history rewind)
A slider rewinds the compass month by month, re-classifying every past month through the same pipeline using the census `history` endpoint. Since NationStates archives numeric scores only (no game category, no budget shares), past months are labelled by compass position and society profile alone; the live label — computed from the complete evidence set — is always the authoritative one.

### 5. World Census Explorer
Every census scale is listed in six groups (Economy, Industry, Government & diplomacy, Health & welfare, Society & culture, Environment & nature, Safety & security, Development, Population & events) with the nation's world percentile. Click a scale to reveal its historical trend line. Scale names not hardcoded are resolved live from the API and cached in `localStorage`.

### 6. Dedicated economy report
A full NSEconomy-style report computed live for the opened entity:
- GDP, GDP per capita, average income, tax rate.
- Output, Consumption, Government expenditures, Imports, Exports, Net trade.
- Worker enthusiasm, consumer confidence, government efficiency (all `×` multipliers).
- Unemployment, exchange rate (both directions: 1 currency → $ and 1 $ → currency), black market size.
- The model follows **broomdces.com/nseconomy** (base values v0.7.0 courtesy of Commerce Heights; black-market equations by Sunset and Tbone Steak): worker enthusiasm = 1 + Civil Rights modifier + Political Freedom modifier + tax modifier; output = production × population × worker enthusiasm × consumer confidence; consumption = output × (1 − tax rate); government budget = output × government efficiency × (tax rate + consumer confidence/10 + worker enthusiasm/40); imports = ((1/consumer confidence)/8) × (consumption + government expenditures); exports = total imports × (output ÷ total output); GDP = consumption + net trade + government expenditures; exchange rate = √(GDP per capita × production ÷ 404,000,000); unemployment is a U-shaped function of GDP per capita minimised near 37,500; the black market grows from low confidence and government waste and shrinks with ethics.
- **Exports and imports need the whole region.** The two region-wide sums (total imports, total output of every region member) are the only figures sourced from the official **daily nations dump** (`nations.xml.gz`), as the NationStates API documentation prescribes for region-wide aggregates. A serverless endpoint downloads the dump at most once per day (pre-warmed at 04:00 UTC), streams through every region and caches the totals, so any region of any size resolves in one request. While the server works, the report shows a loading state with progress; if the endpoint is unreachable it falls back to one minimal request per member nation, paced, and only as a last resort to a provisional estimate.

### 7. Compare two entities
The compare module fetches both entities in parallel and shows their compass positions, freedom profiles and key statistics side by side, with an overlay of both entities' census history on the same chart. (When comparing nations, the old profile box is replaced by the chronological overlay — pick a scale from the dropdown and both timelines are drawn, starting from the date the older of the two entities was founded.)

### 8. World dossier
Global averages, the world compass, per-scale world rankings across the census, and the "Dossier of the day" spotlights (one featured nation and one featured region rotating daily on the homepage).

### 9. Ideology "example nations" (server-maintained)
In the *How the data is calculated* dialog, each ideology row lists a real nation classified as that ideology, rotated daily. The pools are maintained **server-side** with two cooperating sources:
- The **daily data dump** is mined for candidates whose game category and freedom scores match each ideology's profile — zero extra API cost.
- A few large gameplay regions are sampled by day for more candidates.
Every candidate is verified live by the classifier before joining a pool. A **daily scan** (one request per second, hard cap of 250 requests per run, at least 20 verification requests against existing pool members) plus an **hourly tick** (a handful of requests at one per second) keep coverage growing and re-verify existing members until every ideology has at least one verified example; once complete, the tick becomes a no-op. Drifted or defunct example nations are evicted and their ideology re-filled. When a visitor opens an example nation's dossier and the label no longer matches, the mismatch is reported back so the pool is corrected immediately.

### 10. How the data is calculated (in-site documentation)
A built-in dialog explaining every formula and methodology of the site: the compass axes, the society-profile dimensions, the ideology matching with per-ideology census requirements and preferred profiles, the full list of census inputs (28 scales + government budget shares + game category), the economy report equations (with credits), the region trade totals, the API usage policy, and why figures may differ from other calculators (they use a frozen daily snapshot; this site reads the live API).

### 11. UI niceties
- **Dark mode** toggle (persisted in `localStorage`).
- Real-time clock and active-nations ticker on the homepage.
- Site update timer in the footer.
- Forum feedback link, disclaimers, and the footer note: *The site was mostly vibe-coded*.

---

## Development vs. deployed code

The repository keeps **readable sources** (`index.html`, `style.css`, `script.js`) as the canonical files you edit. The Vercel deploy runs `npm run build` (`build.cjs`), which:
1. Regenerates `api/_classifier.cjs` from the classifier definitions inside `script.js` (they must always stay in sync — never edit `_classifier.cjs` by hand).
2. Copies the readable sources plus static assets into `dist/`.
3. Bumps the cache-busting version (`?v=N`) in the HTML.

Build locally with `npm run build` (requires Node.js; no dependencies needed — `package.json` has no runtime dependencies) and preview the readable version by opening `index.html` directly in a browser, or run a local static server from the project root.

---

## Repository map

```
index.html                   Page structure. All templates (nation, region, world dossiers,
                             compare, help dialog) and the SEO head live here.

style.css                    The forum-style visual theme: blue bars, bordered boxes,
                             striped tables, charts, dark mode.

script.js                    The entire application: API calls, XML parsing, the compass
                             + ideology classifier, economy report calculations, chart
                             rendering, history rewind, compare overlays, UI logic.
                             Also the single source of truth for the ideology classifier
                             (build.cjs extracts it into api/_classifier.cjs).

build.cjs                    Deploy build script. Regenerates api/_classifier.cjs from
                             script.js, copies readable sources + assets into dist/,
                             writes dist/version.json.

package.json                 Project metadata. Script: `npm run build`. No dependencies.

vercel.json                  Vercel configuration: build command, output directory,
                             Content-Security-Policy and security headers, and the two
                             cron schedules (region-totals at 04:00 UTC, ideology-examples
                             daily scan at 05:30 UTC).

api/_classifier.cjs          GENERATED — do not edit. Server-side copy of the ideology
                             classifier, regenerated by build.cjs from script.js. Used by
                             the example-nation scan to classify candidates identically
                             to the browser.

api/_seed-examples.js        Bootstrap pools of known example nations per ideology
                             (hand-curated over time). Merged with the Redis-grown pools
                             on every read.

api/ideology-examples.js     Vercel serverless endpoint that reads/writes the example
                             pools (Upstash Redis), serves the daily-rotating examples to
                             the page, runs the daily scan (1 req/s, 250 cap, lock-guarded,
                             re-verifies pool members) and the hourly tick, and accepts
                             mismatch corrections reported by visitors.

api/region-totals.js         Vercel serverless endpoint for the economy report's
                             region-wide export/import totals. Downloads nations.xml.gz
                             at most once per day, streams it, computes total imports /
                             total output per region, caches in Redis; also mines dump
                             candidates for the ideology pools while the stream is open.

api/_mining.js               Shared dump-mining helpers: maps game categories to likely
                             ideologies and extracts candidate nations + scores from the
                             dump stream (no extra API calls).

.github/workflows/ideology-ticks.yml
                             GitHub Actions cron (every hour at :40) that nudges the
                             /api/ideology-examples?tick=1 endpoint so the hourly pool
                             verification runs even when no user visits the site.

dist/                        GENERATED build output (gitignored) — what Vercel serves.

robots.txt                   SEO: crawl rules + sitemap link.

sitemap.xml                  SEO: sitemap for search engines.

favicon.svg                  Browser tab icon.

og-image.png                 Social/OG preview image (1200×630).

README.md                    This file.

.freebuff/                   Local tooling and preview artifacts (gitignored) — not part
                             of the site.
```

---

## API usage policy

All traffic to the NationStates API stays within its published limits, and all requests identify themselves:

- **Browser requests** carry the visitor's own User-Agent plus the identifying `?script=NationStates Dossier Explorer (https://nationstates-dossier-explorer.vercel.app)` query parameter, spaced ≥ 700 ms apart through a single queue with backoff on rate-limit responses.
- **Server-side requests** (the daily dump download and the example-nation scan) set an explicit User-Agent: `NS-Dossier-Explorer (https://nation-states-analyzer.vercel.app)`, run at one request per second, have a hard cap per run, a lock against overlapping runs, and stop immediately on rate limiting.

---

## Deliberate limits

- **Public data only** — no login, no private shards (telegrams, issues, etc.). Anyone can look up any public nation or region.
- **Huge regions** — the nation roster is capped at 300 chips to avoid freezing the browser with thousands of DOM elements.
- **Example pools** — rare, census-gated ideologies can take a while to find a verified example; the scanning continues automatically until every ideology is covered.

---

## License

Do whatever you like with this code (MIT-style, no warranty). The data shown belongs to the respective NationStates players and is fetched live from their public API, mostly vibe-coded.

Not affiliated with NationStates or Jennifer Government PTY LTD.
