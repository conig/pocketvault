# Pocket Vault

A small, read-only, installable web app for the existing GitHub-backed Markdown vaults. No Git working copy, editor, push operation, or server-side note database.

## Use on Android

1. Open the privately deployed Site and sign in as its owner.
2. Tap **Connect GitHub**. The repository name is prefilled; leave Branch blank for the repository default.
3. For the private vault repository, create a **fine-grained personal access token** at GitHub → Settings → Developer settings → Personal access tokens. Grant access to **only the notes repository**, with **Contents: Read-only** (Metadata read is automatic). Do not use a classic broad-scope token. Paste the token into the app, not into chat.
4. Optionally select **Remember token on this device** on your own trusted phone. Without this opt-in, credentials live only in page memory; offline notes still work, but a later session needs the token again to refresh.
5. Connect and keep the screen awake through the initial download. Subsequent refreshes fetch only changed Markdown blobs.
6. Use Chrome → **Add to home screen / Install app**. Reading and search work offline after the app shell and initial snapshot finish saving. Android/browser storage eviction can remove cached data; the repository remains the source of truth.

It checks for updates on opening when credentials are available, on reconnect, and when returning to the foreground after one hour. The refresh button checks immediately. There is **no daily background timer while closed**: this is deliberate, because fetching on use is enough for a reader and avoids unreliable mobile background scheduling. New content appears only after the existing desktop backup pushes it to GitHub.

## Included

- Search across human titles, aliases and full note contents; AND terms and quoted phrases; title-weighted results and snippets. YAML `title` / human aliases outrank generated identifiers. Timestamp IDs are not prominent headings; source paths are collapsed under Source details.
- Tags extracted from YAML, plain `Tags:` lines and inline hashtags, displayed in both list and reader. Filter by tag or search `#tag` (including hierarchical tags). Compact date, reading time and recipe facts appear when available.
- **Settings → Vaults on this device** after connection: choose work, personal, cooking, and/or codex, then **Save vault selection**. Choices persist per device and control downloads, full-text search and navigation filters. At least one vault must stay selected.
- Removing vaults works offline and atomically deletes their saved notes, file names and unreferenced attachments; GitHub is never changed. Adding vaults downloads only their missing notes, even when the GitHub commit has not changed; it requires network/GitHub access. Failed downloads retain the previous complete selection. Closing Settings without saving discards edits. Existing installs default to all four vaults. Only per-vault note counts are retained for excluded vaults.
- Separate filters for selected vaults.
- Markdown tables with alignment, lists, read-only tasks, fenced code with syntax highlighting, footnotes and navigation, callouts (including folds), highlights, safe HTML (such as details/summary/br), dollar/bracket/fenced TeX math, relative links, aliases, wikilinks, and note/heading embeds. Embeds cap depth at three and block cycles. Untrusted HTML is sanitized; executable HTML and raw styling are deliberately not supported.
- Dark-terminal presentation with bundled JetBrains Mono (regular/bold), compact titles and visible tags; dark regardless of device preference. Fonts, code/math modules and KaTeX assets are self-hosted and offline-cached. No font CDN.
- Responsive list/detail reading view, browser back navigation, keyboard `/` search shortcut.
- Cached-first installed launch: hosting/auth latency does not block saved notes; first display paints a bounded 50-note page with Show more, while search includes the entire library. Rendering/math/code modules load lazily, background refresh yields until the cached view is ready, and unchanged checks do not rewrite/redraw the library.
- A pinned-commit snapshot with incremental blob reuse and atomic IndexedDB replacement. Deleted notes disappear on successful refresh. Failed downloads preserve the last complete snapshot.
- Offline app shell and full note search. Internal raster images/PDFs download on demand and are cached after viewing (20 MB per attachment limit).
- **Forget this device** clears notes, attachments, configuration and any remembered token, but never touches GitHub. Only the non-sensitive app shell remains cached.
- Explicit synthetic sample library, never mixed with or saved over the connected repository.

## Privacy / security model

- All repository requests are GETs directly to `https://api.github.com`. No GitHub token or note contents are sent to the Site host. No analytics, third-party JS/CDNs, remotely loaded fonts, or backend API.
- Repository name is an editable default, not a credential. No private vault content is bundled, tested against, or published with the application.
- Tokens are **not validated for read-only scope by the app**: enforce this when creating the fine-grained token. Even if a broader token is entered, the app only implements read requests. HTTPS and repository-scoped tokens are required for private deployment.
- Optional remembered tokens and cached notes are browser-local **not encrypted at rest by this app**. Treat them like other downloaded personal files; use a trusted, screen-locked device. Hosting authentication protects online access, not an already downloaded offline cache. Browser extensions or compromised same-origin app code can access browser storage. Revoke expired/unneeded tokens in GitHub.
- Hidden paths, symlinks and all folders outside the explicit vault allowlist are excluded. This is not content-level secret scanning: a sensitive value in an included Markdown note is still downloaded.
- Markdown HTML is sanitized with DOMPurify (HTML-only profile, prefixed IDs, no scripts/forms/style attributes). Raw inputs are removed except disabled task checkboxes. Only trusted KaTeX output may use inline style attributes after sanitization, with trust disabled and expansion/size limits. A restrictive CSP blocks third-party scripts/images. External images are omitted to prevent tracking. External links open explicitly with no referrer or opener.
- Client storage is not backup. The existing GitHub backup process remains unchanged.

## Limitations

Not a complete Obsidian runtime: no Dataview, plugins, canvas, live queries, Mermaid or SVG attachment rendering. TeX math is supported through KaTeX, not a full LaTeX document engine. Ambiguous wiki basenames are not guessed. Block references support paragraph embeds; complex Obsidian block semantics are not guaranteed. Note attachments are offline only after viewing; selected notes and renderer/font assets are cached. A one-time background metadata refresh re-downloads legacy note blobs to recover aliases/frontmatter discarded by the old parser; old caches remain usable immediately without waiting. GitHub API rate/size limits apply: 2 MB per note, 20 MB per supported attachment, and recursive trees must not be truncated. Interrupted first downloads require retrying. Service-worker installation/offline behavior through the production sign-in gateway must be checked on the actual phone.

## Development

Requires Node.js and npm. Browser tests additionally require Chromium (the test uses `/usr/bin/chromium`, or `CHROMIUM_PATH` if set) and a loopback preview on port 4173.

```sh
npm ci
npm test
npm run build
npm run preview
# Another terminal, using a headless browser only:
npm run test:browser
# Chrome manifest/installability regression, with its own local cookie-gated server:
npm run test:installability
# With the preview running, test connected vault selection:
npm run test:vaults
npm run test:rendering
npm run test:performance
```

Unit tests cover allowlists, parsing, search/ranking, resolution, incremental/deletion behavior, authentication errors and GET-only networking. Browser tests use **synthetic fixtures and fake tokens**, covering phone navigation, section embeds, injection defense, offline reload/search, token opt-in/opt-out, refresh failure recovery, incremental updates, layout bounds and forgetting the device. Captures are written to `/tmp/pocket-vault-qa/`, never into the repository. `test:installability` starts a real cookie-gated HTTP server and a clean, non-incognito headless Chromium profile, loads the built app, and checks Chrome’s parsed manifest and installability errors. It covers the initial signed-in visit before a service worker can mask manifest-auth failures. The manifest link uses `crossorigin="use-credentials"`, required even on the same origin when the manifest is protected by sign-in. This browser test does not emulate Android’s WebAPK minting service; final installation on the actual phone still requires confirmation.

Source lives in `~/repos/pocketvault`, separate from the notes repository so the daily vault autosync does not stage an embedded Git repository. Sites identity is retained in `.openai/hosting.json`. Build output is `dist/`; it contains no runtime credentials or note snapshots. The build derives a service-worker cache version from shell content for automatic offline updates.

## Startup and rendering verification

`test:performance` uses a real worker/IndexedDB/HTTP server, 532 synthetic notes (~2.8 MB), 4× CPU throttling and a 1.8 s hosting-navigation delay. The original network-first build measured 2452 ms and failed its <1300 ms cached-launch budget. The cached-first/bounded-render build measured 437–443 ms in the same harness; full-library search was 63–69 ms. These are reproducible lab measurements, not a claim about every phone or first-time install.

`test:rendering` originally failed because a generated ID won over a human alias. It now verifies human titles, all three tag formats, tag filtering, tables/alignment, tasks, footnotes/scrolling, callouts, highlights, code syntax, safe HTML/XSS defense, math and offline font/math availability. Existing offline, selection and cookie-gated installation suites also run. Unicode/CommonMark support is provided by Markdown-it; no claim of compatibility with every Obsidian plugin or arbitrary HTML/LaTeX is made.

Service-worker navigation is cache-first after installation. As before, the online sign-in gate is **not** a lock on downloaded notes. Updates cache a complete new shell; one previous immutable chunk set stays available for open older tabs. A Reload update control appears when a new worker takes control. No private notes are added to the shell cache or app deployment.

## Non-destructive cache recovery

The host canonicalizes `/index.html` to `/`. Replaying the cached redirected response for a navigation caused Chrome `ERR_FAILED` while Incognito worked. Shell responses are now normalized to remove redirect history, validated to reject sign-in pages, and installed atomically from canonical HTML. Cached assets are validated before reuse; failed/missing assets are refetched. Shell-code changes also change the cache version. Authentication/callback paths bypass the worker.

Missing shell plus no network renders an actual recovery page rather than Chrome’s network-error screen. `/?recover=1` repairs shell HTML online. This path never clears IndexedDB, credentials, notes or selected vaults. `npm run test:cache-recovery` reproduces the original redirect failure and verifies poisoned cache recovery, missing-cache/offline handling, online repair, auth-route passthrough and preserved IndexedDB. Successful population/sync no longer shows the floating “notes ready” notice; sync freshness stays in the footer. Errors are still reported.

## Failed-refresh startup retention

A stale restored note URL previously skipped painting the entire cached list during cold startup; a failed background GitHub request then left an apparently empty reader even though IndexedDB still held the notes. `test:startup-retention` reproduced that blank view (zero displayed versus two stored notes), and now verifies the library always paints before restored-note resolution, stale links fall back to the library, and failed startup/reconnection leaves storage intact. It also covers Settings → Device cache & connection, a read-only report of this origin's saved note count, vaults, remembered-token presence (never its value), storage-persistence status and a public GitHub reachability probe. Different origins/browser profiles—including Incognito—have separate caches; a passing probe elsewhere cannot establish connectivity or data presence on a particular phone.

Successful repair removes the one-shot `recover` query flag from the current URL; subsequent launches return to cached-first/offline behavior. The recovery test verifies this and an immediate offline reload after repair. A repaired shell is not a new browser origin and does not reset IndexedDB.

## Focused source workspace

Setup occupies its own screen until a snapshot exists. Connected users see only the library and reader; settings and filters are on demand. NvChad One Dark-inspired panes use self-hosted JetBrains Mono. Source reading preserves Markdown headings, emphasis delimiters, list markers, fences, tables and spacing, with coloured syntax and concealed clickable link destinations. No generated article title, reading-time block, explanatory welcome, or persistent offline notice. Raw HTML remains inert. Source paints immediately using the existing parser, then a lazy Tree-sitter Markdown parser adds structural highlighting. Runtime and canonical v0.5.4 grammar are self-hosted and cached offline; neither delays the library or initial source paint. CSP permits WebAssembly compilation only, not JavaScript eval. Source mode intentionally shows math, tables and embed notation rather than typesetting them. The existing rich renderer remains available internally for regression coverage.
