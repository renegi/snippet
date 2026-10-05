# Accuracy work: handoff notes

Notes for the next session, which focuses on podcast/episode identification accuracy. Written at the end of the October 2026 cleanup (PRs #1–#8) and updated after the matching rewrite that replaced the first-success cascade with a scored resolver.

## Where things stand

- **Live app:** https://snippetapp.vercel.app (Vercel, Hobby plan). Every PR gets a Vercel preview deploy; the owner tests previews on their phone before merging.
- **Observed accuracy:** in two live tests, the owner uploaded two screenshots each time and **one of the two was identified correctly** in both tests. We don't yet know which screenshots failed or how (wrong podcast, wrong episode, or nothing found). **First step: get those screenshots from the owner** and add them as fixtures.
- **Timestamps:** read correctly on all 7 fixtures since PR #1 (see "Already fixed").
- **Speed:** the rewrite cut Apple requests to 2–4 per screenshot in the offline tests (see step 7 below).

## How identification works

The request flow, with file pointers:

1. **Client** (`client/src/services/api.js`, `processScreenshot`): uploads one screenshot per request, two at a time. Files are re-encoded to JPEG at original size only if they're over 4 MB or in a format Vision can't read (e.g. HEIC).
2. **Route** (`server/api/extractRouter.js`): passes the image buffer to `visionService.extractText`.
3. **OCR** (`server/services/visionService.js`): Google Vision `textDetection` returns `textAnnotations` (one entry with the full text, then one per word, each with a bounding box).
4. **`analyzeAnnotations`** (`visionService.js`):
   - `normalizeToReferenceWidth` scales all coordinates so the image is **1170 px wide**. The pixel thresholds were tuned on 1170-px iPhone screenshots. The owner's current phone produces **1125×2436**, and the test fixtures are 924×2000 (downscaled), so this normalization matters.
   - `extractTextCandidates` (`vision/candidates.js`): groups words into lines (`groupWordsIntoLines`, 18 px line tolerance). It then filters lines by vertical position: the primary band is 45–87.5% of image height, with fallback bands (`filterByPositionImageRelative`), plus size and text filters (`isValidCandidate`). Survivors are ranked by `scoreCandidate`, top 8 kept.
   - `extractTimestamp` (`vision/timestamp.js`): picks the time on the same row as the remaining time (`15:14 … -15:36`), falling back to the lowest time on screen.
   - `extractPlayback` (`vision/timestamp.js`): elapsed + remaining time = the episode's length (`durationSeconds`), used as a matching signal.
5. **`validateCandidates`** (`vision/validation.js`) runs the resolver and shapes the API result. Besides the podcast/episode it reports `method`, `signals` (name/title/duration scores), `ambiguous`, `alternatives` (runner-up episodes, for a future "did you mean" picker), `appleRequests` and `rateLimited`.
6. **Resolver** (`services/matching/resolver.js`) scores combinations instead of returning the first success. It doesn't decide in advance which line is the podcast: it searches each line (up to 4) as a podcast name (50 results each), scores every result's name against *all* lines, and fetches the episodes of up to 3 podcasts **in order of fit**, scoring every episode against the other lines. Many shows share a name (a dozen are called exactly "Another Podcast"), so ties are broken by a screen line naming the host/publisher (Apple's `artistName`) and by being Apple's first result (its most popular fit). An exact, unrivalled name is checked straight away, which usually ends the search after 2 requests. Each (podcast, episode) gets three signals, combined into one score:
   - **name** (`nameScore`): screen line vs podcast name, both directions, so artwork text merged into the line or a cut-off name still match.
   - **title** (`titleScore`): screen line vs episode title. The first and last screen words may be partial words, because players truncate titles and lock-screen marquees show a window from the middle.
   - **duration** (`durationScore`): the player's length vs Apple's `trackTimeMillis`, with tolerance for ads inserted per listener. It separates same-prefix titles ("Never Been Loved" vs "Never Been Kissed") and rejects wrong recent episodes.
   - Sources, in order: Apple's 200 most recent episodes; then the top podcast's **RSS feed** (full back catalog, not rate-limited by Apple); then Apple's **episode search**, which finds the podcast from the episode title, with the podcast name confirmed by another screen line. Last resorts: the podcast with "Unknown Episode", or "Episode not found".
   - Acceptance: title ≥ 0.85 whatever the length (it still lowers the score); title ≥ 0.6 with a roughly matching length (≥ 0.7 if the player shows no length); or title ≥ 0.55 with a closely matching length. Looser rules returned look-alike episodes ("…the labor market" for "…the labor market tea leaves") when the real one had left the catalog. Two different episodes within 0.05 of each other set `ambiguous`.
   - Podcast-only results need an exact name (≥ 0.95) that is unique, Apple's first result, or confirmed by a host line. Otherwise the answer is "not found": a wrong podcast is worse than none.
   - `nameScore` treats a catalog name that starts the screen line as a match ("Good One: A Podcast About Jokes" is "Good One" in Apple) and penalizes extra words in front ("Not Another Podcast").
7. **Apple access** (`services/matching/appleCatalog.js`): one instance per screenshot; every URL is fetched at most once, requests are counted, and HTTP 403/429 sets `rateLimited` instead of passing as "not found". Typically 2–4 Apple requests per screenshot, up to 9 on a miss (previously 5 on a first-try match, 17–22 on a miss). `text.js` normalizes accents, so "Edición" equals "Edicion".

8. **"Which episode is this?" picker** (`client/src/components/EpisodePickerModal.jsx`): when the result is a guess between near-equal episodes, only the podcast, or nothing, `validation.needsConfirmation` is set and `validation.suggestions` lists up to 5 likely episodes (podcast + episode in the same shape as `validatedPodcast` / `validatedEpisode`). The client opens the picker once processing finishes, one unsure screenshot at a time; "None of these" opens the manual search (edit) modal. In the list, a screenshot without an episode reads "Unidentified episode" with a "Select episode" button that opens the picker (or the manual search when there are no suggestions). The picker ends with a note saying how far back the show's episodes could be seen (`validation.oldestEpisodeDate`), since older ones can't be listed.

`applePodcastsService.js` now only serves the manual search/edit screens and transcript audio lookups.

## Test tooling

- **Run tests:** `cd server && npm test` (Node's built-in runner), all offline:
  - `test/ocr.test.js`: for each fixture, the timestamp, the episode length, and that the expected podcast/episode text are among the candidates. Expectations live in `test/fixtures/screenshots/expected.json`.
  - `test/identification.test.js`: the full pipeline per fixture against a **fake** Apple catalog in Apple's real response shape (`test/fixtures/fakeApple.js`, with decoy titles, look-alike podcasts and an RSS-only episode), plus unit tests for the scoring.
  - `test/replay.test.js`: the full pipeline against **recorded real** Apple responses (`*.apple.json`, recorded October 2026). Three of the five screenshots are from mid-2025 and their episodes have since left Apple's list, the RSS feed and Apple's episode search, so `expected.json` (`replay`) expects the podcast alone or "not found" for them, never a look-alike episode.
  - `test/audioUrl.test.js`: audio-URL lookup with `fetch` stubbed.
- **Fixtures:** `server/test/fixtures/screenshots/*.jpg`, plus the recorded Vision response next to each image (`*.vision.json`).
- **Recording new fixtures:** `npm run capture-fixtures`. It needs Google credentials in `server/.env`, so **the owner runs it on their Mac**. Credentials are deliberately *not* put in the cloud environment. Steps:
  1. Add the image to the fixtures folder.
  2. The owner runs the script.
  3. Commit the new `.vision.json`.
- **`expected.json`:** the full titles of the 3 truncated episodes are still unconfirmed (`confirmed: false`). It currently checks only OCR-stage text, not the final Apple match.
- **Sandbox network:** the cloud sandbox **can't reach `itunes.apple.com`**, `vercel.com` or `use.typekit.net`, so Apple matching can't be run live from a session.

### Recording real Apple responses

`npm run capture-apple` (in `server`) runs identification for every fixture against the real Apple catalog and saves each response to `<name>.apple.json`; `test/replay.test.js` then replays them. It needs internet access to Apple but **no credentials**, so it can run on the owner's Mac (the cloud sandbox can't reach Apple). It waits 15 s between screenshots to stay under the rate limit. If matching later makes different requests, the replay test says to re-record with `--force`.

### Diagnosing a live misidentification

Set `DEBUG_LOGS=true` in Vercel's environment variables (Production), redeploy, and reproduce. Step-by-step logs then appear in Vercel's **Logs** tab: candidates and the top-scoring (podcast, episode) combinations with their signals. Even without debug logs, each request's info log shows the `method`, `appleRequests` and `rateLimited`. **Turn it off afterwards**, because the debug logs include the full OCR text of users' screenshots. The owner can copy logs from the dashboard (JSONL) and paste them into the session.

## Open questions

- **OCR reads "AI" as "Al"** (lowercase L) on the Spotify fixture, which is why Apple's episode search found nothing for it live. The title still scores 0.9 against the episode list, but the episode-search fallback is blind to it. Spotify's "E" badge also lands in the podcast line ("E Another Podcast").
- **Episode search with cut-off words** finds little ("ading the labor market tea"). Dropping partial first/last words didn't help for the aged-out fixtures; worth retrying on a recent episode.

- **Was rate limiting behind the "1 of 2 correct" tests?** The old matcher made up to ~22 Apple requests per screenshot, with two screenshots processed at once, against Apple's ~20/minute. Check the `rateLimited` field in the logs when testing.
- **Players that show total length instead of remaining time** give no duration yet; matching then relies on the title alone.
- **Thumbnail text and promo cards** still reach the candidates, but they no longer need to be paired correctly: they only lose on score. Overcast ads are still untested.
- **A leftover hard-coded clock pattern.** `vision/timestamp.js` `hasClockContext` contains `4:30a.m.`, a patch for one screenshot; probably removable.

## Already fixed (don't re-investigate)

- **Wrong timestamp from a notification** below the player ("4:30" in a charging notice): fixed by preferring the remaining-time row. Covered by the `marketplace-lockscreen` test.
- **Pixel thresholds wrong on other screen sizes:** fixed by normalizing to 1170 px. This fixed the missed podcast line on `where-should-we-begin-promo-card` and a junk pair from cover art on `search-engine-lockscreen`.
- **Mock transcripts shown as real:** removed. Transcript errors now say why.
- **October 2026 matching rewrite** (replaced the first-success cascade with the resolver). Bugs it removed: episode text was compared to the *podcast* name (`findBestMatch` used `collectionName` first), exact title matching read a field Apple doesn't return, the podcast's own row was scored as an episode, a `0.00001` acceptance threshold, `cleanPodcastText` dropping every word ending in "w", accents stripped, episode IDs `undefined`, the episode cache cleared on every call, and two fallbacks that could never run. Candidate filters no longer drop titles like "10 Percent Happier" (read as a date) or ones containing "para las", "julio" or "sueño".

## Working agreements with the owner

- **Responses:** concise; explain trade-offs briefly. The owner isn't deep in the code, so give plain-language steps for anything they run.
- **Changes:** one PR per change, from the session's branch. Wait for the Vercel preview to go green, and let the owner test on their phone when it affects behaviour.
- **Credentials:** never in the cloud environment. Anything needing Google credentials (fixture capture) runs on the owner's Mac.
- **Owner's Mac:** the repo lives in a folder called "Podcast Quote Grabber", and credentials are in `server/.env`. The owner may still need to move `.env` from the pre-restructure `snippet/server/.env`. There's also an old `git stash` of uncommitted `visionService.js` / `PodcastScreenshotProcessor.jsx` edits from before this cleanup, never reviewed. Ask before assuming it's obsolete; it could contain accuracy experiments.
