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

- Search across titles and full note contents; AND terms and quoted phrases; title-weighted results and snippets.
- Separate work, personal, cooking, and codex filters.
- Markdown, YAML titles/tags, relative links, wikilinks, note embeds and heading-section embeds (depth capped at three; cycles blocked).
- Responsive list/detail reading view, browser back navigation, keyboard `/` search shortcut.
- A pinned-commit snapshot with incremental blob reuse and atomic IndexedDB replacement. Deleted notes disappear on successful refresh. Failed downloads preserve the last complete snapshot.
- Offline app shell and full note search. Internal raster images/PDFs download on demand and are cached after viewing (20 MB per attachment limit).
- **Forget this device** clears notes, attachments, configuration and any remembered token, but never touches GitHub. Only the non-sensitive app shell remains cached.
- Explicit synthetic sample library, never mixed with or saved over the connected repository.

## Privacy / security model

- All repository requests are GETs directly to `https://api.github.com`. No GitHub token or note contents are sent to the Site host. No analytics, third-party JS/CDNs, remote fonts, or backend API.
- Repository name is an editable default, not a credential. No private vault content is bundled, tested against, or published with the application.
- Tokens are **not validated for read-only scope by the app**: enforce this when creating the fine-grained token. Even if a broader token is entered, the app only implements read requests. HTTPS and repository-scoped tokens are required for private deployment.
- Optional remembered tokens and cached notes are browser-local **not encrypted at rest by this app**. Treat them like other downloaded personal files; use a trusted, screen-locked device. Hosting authentication protects online access, not an already downloaded offline cache. Browser extensions or compromised same-origin app code can access browser storage. Revoke expired/unneeded tokens in GitHub.
- Hidden paths, symlinks and all folders outside the explicit vault allowlist are excluded. This is not content-level secret scanning: a sensitive value in an included Markdown note is still downloaded.
- Raw HTML is disabled in Markdown; output is sanitized with DOMPurify. A restrictive CSP blocks third-party scripts/images. External images are omitted to prevent tracking. External links open explicitly with no referrer or opener.
- Client storage is not backup. The existing GitHub backup process remains unchanged.

## Limitations

Not a complete Obsidian runtime: no Dataview, plugins, canvas, LaTeX rendering, live queries, block-level rich embeds or SVG attachment rendering. Ambiguous wiki basenames are not guessed. Block references have only basic single-line embed support. Assets are offline only after viewing; notes are all cached. GitHub API rate/size limits apply: 2 MB per note, 20 MB per supported attachment, and recursive trees must not be truncated. Interrupted first downloads require retrying. Service-worker installation/offline behavior through the production sign-in gateway must be checked on the actual phone.

## Development

Requires Node.js and npm. Browser tests additionally require Chromium (the test uses `/usr/bin/chromium`, or `CHROMIUM_PATH` if set) and a loopback preview on port 4173.

```sh
npm ci
npm test
npm run build
npm run preview
# Another terminal, using a headless browser only:
npm run test:browser
```

Unit tests cover allowlists, parsing, search/ranking, resolution, incremental/deletion behavior, authentication errors and GET-only networking. Browser tests use **synthetic fixtures and fake tokens**, covering phone navigation, section embeds, injection defense, offline reload/search, token opt-in/opt-out, refresh failure recovery, incremental updates, layout bounds and forgetting the device. Captures are written to `/tmp/pocket-vault-qa/`, never into the repository.

Source lives in `~/repos/pocket-vault`, separate from the notes repository so the daily vault autosync does not stage an embedded Git repository. Sites identity is retained in `.openai/hosting.json`. Build output is `dist/`; it contains no runtime credentials or note snapshots. The build derives a service-worker cache version from shell content for automatic offline updates.
