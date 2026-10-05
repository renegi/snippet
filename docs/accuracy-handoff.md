# Accuracy work: handoff notes

Notes for the next session, which focuses on podcast/episode identification accuracy. Written at the end of the October 2026 cleanup, after PRs #1–#8. Everything below is current as of `main` after the OCR split.

## Where things stand

- **Live app:** https://snippetapp.vercel.app (Vercel, Hobby plan). Every PR gets a Vercel preview deploy; the owner tests previews on their phone before merging.
- **Observed accuracy:** in two live tests, the owner uploaded two screenshots each time and **one of the two was identified correctly** in both tests. We don't yet know which screenshots failed or how (wrong podcast, wrong episode, or nothing found). **First step: get those screenshots from the owner** and add them as fixtures.
- **Timestamps:** read correctly on all 5 fixtures since PR #1 (see "Already fixed").
- Identification *speed* work was deliberately deferred into this effort, because it touches the same matching code (see "Speed items").

## How identification works

The request flow, with file pointers:

1. **Client** (`client/src/services/api.js`, `processScreenshot`): uploads one screenshot per request, two at a time. Files are re-encoded to JPEG at original size only if they're over 4 MB or in a format Vision can't read (e.g. HEIC).
2. **Route** (`server/api/extractRouter.js`): passes the image buffer to `visionService.extractText`.
3. **OCR** (`server/services/visionService.js`): Google Vision `textDetection` returns `textAnnotations` (one entry with the full text, then one per word, each with a bounding box).
4. **`analyzeAnnotations`** (`visionService.js`):
   - `normalizeToReferenceWidth` scales all coordinates so the image is **1170 px wide**. The pixel thresholds were tuned on 1170-px iPhone screenshots. The owner's current phone produces **1125×2436**, and the test fixtures are 924×2000 (downscaled), so this normalization matters.
   - `extractTextCandidates` (`vision/candidates.js`): groups words into lines (`groupWordsIntoLines`, 18 px line tolerance). It then filters lines by vertical position: the primary band is 45–87.5% of image height, with fallback bands (`filterByPositionImageRelative`), plus size and text filters (`isValidCandidate`, `hasSystemTextStructure`). Survivors are ranked by `scoreCandidate`, top 8 kept.
   - `extractTimestamp` (`vision/timestamp.js`): picks the time on the same row as the remaining time (`15:14 … -15:36`), falling back to the lowest time on screen.
5. **`findSpatialPairs`** (`vision/pairing.js`): pairs candidates within 100 px vertically. The theory is that the episode title and podcast name sit on adjacent lines.
6. **`validateCandidates`** (`vision/validation.js`) tries strategies in order and **returns the first success**:
   - **Strategy 1:** for each pair, try bottom = podcast / top = episode, then the reverse (`validateSpatialPair`).
   - **Strategy 2:** cross-pair. Podcasts that validated without their episode are retried with episode text from other pairs.
   - **Strategy 3:** each candidate alone as a podcast (confidence ≥ 0.7), with the closest vertical candidate as the episode, plus a broad episode search.
   - **Fallbacks:** the best podcast with "Unknown Episode", or "Episode not found".
7. **Apple matching** (`server/services/applePodcastsService.js`):
   - `validatePodcastInfo` runs `searchPodcast` (iTunes search, `limit=5`, similarity > 0.7). If that fails, it runs `fuzzySearchPodcast`: phase 1 on cleaned text, phase 2 on the "middle words", accepting candidates at confidence ≥ 0.85.
   - Episodes come from `lookup?id=…&entity=podcastEpisode&limit=200`, i.e. **only the 200 most recent episodes**, then matching by `findExactEpisodeMatch`, `fuzzySearchEpisodeInPodcast` (keyword match) or `searchEpisode` (best similarity).
   - `calculateSimilarity` returns 1 for an exact match after normalizing. A substring scores **0.8–1.0**, which favours truncated titles. Otherwise it uses partial-word and Levenshtein-style scoring.

## Test tooling

- **Run tests:** `cd server && npm test` (Node's built-in runner). 18 tests, all offline:
  - `test/ocr.test.js`: for each fixture, the timestamp and that the expected podcast/episode text gets paired. Expectations live in `test/fixtures/screenshots/expected.json`.
  - `test/audioUrl.test.js`: audio-URL lookup with `fetch` stubbed.
- **Fixtures:** `server/test/fixtures/screenshots/*.jpg`, plus the recorded Vision response next to each image (`*.vision.json`).
- **Recording new fixtures:** `npm run capture-fixtures`. It needs Google credentials in `server/.env`, so **the owner runs it on their Mac**. Credentials are deliberately *not* put in the cloud environment. Steps:
  1. Add the image to the fixtures folder.
  2. The owner runs the script.
  3. Commit the new `.vision.json`.
- **`expected.json`:** the full titles of the 3 truncated episodes are still unconfirmed (`confirmed: false`). It currently checks only OCR-stage text, not the final Apple match.
- **Sandbox network:** the cloud sandbox **can't reach `itunes.apple.com`**, `vercel.com` or `use.typekit.net`, so Apple matching can't be run live from a session.

### Recommended next tooling: record and replay Apple responses

Final podcast/episode results can't be tested offline yet. The proposal:

1. Extend `scripts/capture-vision-fixtures.js` to run the full pipeline (`visionService.extractText`) with `global.fetch` wrapped to record every iTunes request and response. Save them as `<name>.apple.json`, a map from URL to response body.
2. Add a test that replays those responses through a stubbed `fetch` and asserts the final `validation.validatedPodcast.id` / `validatedEpisode.title`, with new fields in `expected.json`.
3. The owner re-runs `npm run capture-fixtures -- --force` once on their Mac.

The OCR split was verified with a throwaway harness of this shape, using a **fake** catalog (5 podcasts plus decoys, a few episodes each). All 5 fixtures resolved correctly against it. That shows the pipeline works when Apple's search behaves nicely; **real misidentifications most likely come from how Apple's actual search results rank**, which is why recorded real responses are needed.

### Diagnosing a live misidentification

Set `DEBUG_LOGS=true` in Vercel's environment variables (Production), redeploy, and reproduce. Step-by-step logs then appear in Vercel's **Logs** tab: candidates, pairs, every Apple query and score. **Turn it off afterwards**, because the debug logs include the full OCR text of users' screenshots. The owner can copy logs from the dashboard (JSONL) and paste them into the session.

## Leads (suspected, not yet verified)

**Loose thresholds that can accept wrong episodes.** Strategy 1 returns on the *first* pair that "succeeds", so a permissive episode match can win before a better pair is tried. All in `applePodcastsService.js`:

| Line | What it does |
|---|---|
| 566 | `matchScore >= 0.00001`, commented "Temporary very low threshold for debugging". Effectively accepts anything in `fuzzySearchEpisodeInPodcast`. |
| 703 | `searchEpisode` accepts the best match at similarity > **0.2** (lowered from 0.4 for truncated titles). |
| 757, 841, 856 | Episode search and best-match thresholds of > **0.1**. |

**Other leads:**

- **Thumbnail text merges into titles.** Example: `where-should-we-begin-promo-card` reads `WHERE SHOULD Where Should We Begin? w`, because the small artwork's text joins the podcast line. This is the README's known bug (Every Little Thing, Good One).
- **Promo cards and ads** under the title can form their own pair ("Esther's Office Hours" + "Edición para suscriptores…"). Overcast ads are another listed known bug.
- **Only the 200 most recent episodes are considered.** An older episode can't match, and with the low thresholds above, a wrong recent episode may be accepted instead.
- **Accented characters are dropped.** `calculateSimilarity` normalizes with `/[^\w\s]/g`, which strips non-ASCII letters, so Spanish titles (the owner's phone is in Spanish) lose their accented characters before comparison.
- **The episode cache never helps.** `validatePodcastInfo` calls `clearEpisodeCache()` on every call (line 42), and each validation runs many **sequential** iTunes requests. Apple's search API is rate-limited (roughly 20 requests/minute), and request errors are caught and treated as "not found", so **rate limiting can look like a matching failure**.
- **Inconsistent episode IDs.** `validatedEpisode.id` may be `undefined` on some paths: `fuzzySearchEpisodeInPodcast` uses `exactMatch.id` / `bestMatch.episode.id` (lines 462, 594) on raw iTunes results, which have `trackId`, not `id`. That affects deep links, and transcript lookup falls back to matching by title.
- **A leftover hard-coded clock pattern.** `vision/timestamp.js` `hasClockContext` contains `4:30a.m.`, a patch for one screenshot. The same-row timestamp rule fixed that case properly (see below), so it's probably removable.

## Already fixed (don't re-investigate)

- **Wrong timestamp from a notification** below the player ("4:30" in a charging notice): fixed by preferring the remaining-time row. Covered by the `marketplace-lockscreen` test.
- **Pixel thresholds wrong on other screen sizes:** fixed by normalizing to 1170 px. This fixed the missed podcast line on `where-should-we-begin-promo-card` and a junk pair from cover art on `search-engine-lockscreen`.
- **Mock transcripts shown as real:** removed. Transcript errors now say why.

## Speed items (deferred into this work)

- Make the episode cache per request instead of clearing it on every call. That's the same request repeated within one screenshot, so results can't change.
- Reduce the number of sequential iTunes calls per screenshot, keeping the rate limit in mind before parallelizing.

Both touch the matching code, so do them once recorded Apple responses can confirm results don't change.

## Working agreements with the owner

- **Responses:** concise; explain trade-offs briefly. The owner isn't deep in the code, so give plain-language steps for anything they run.
- **Changes:** one PR per change, from the session's branch. Wait for the Vercel preview to go green, and let the owner test on their phone when it affects behaviour.
- **Credentials:** never in the cloud environment. Anything needing Google credentials (fixture capture) runs on the owner's Mac.
- **Owner's Mac:** the repo lives in a folder called "Podcast Quote Grabber", and credentials are in `server/.env`. The owner may still need to move `.env` from the pre-restructure `snippet/server/.env`. There's also an old `git stash` of uncommitted `visionService.js` / `PodcastScreenshotProcessor.jsx` edits from before this cleanup, never reviewed. Ask before assuming it's obsolete; it could contain accuracy experiments.
