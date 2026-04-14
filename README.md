# public-docs — Docs Sync Demo

This repo is the public-facing half of a bi-directional GitHub docs sync demo.
Files here are automatically kept in sync with
[`private-monorepo/docs/`](https://github.com/DeweyMarco/private-monorepo/tree/main/docs)
based on frontmatter tags.

> **Don't edit synced files here directly** — edits to `getting-started.mdx` and
> `api-overview.mdx` will be overwritten on the next push from `private-monorepo`.
> Make those edits in the private repo instead (or edit here to test the reverse direction).

---

## File breakdown

| File | Tags | Source |
|------|------|--------|
| [`docs/intro.mdx`](docs/intro.mdx) | `[public]` | Lives here only — not synced |
| [`docs/getting-started.mdx`](docs/getting-started.mdx) | `[public, private]` | Synced from `private-monorepo` |
| [`docs/api-overview.mdx`](docs/api-overview.mdx) | `[public, private]` | Synced from `private-monorepo` |

---

## Key files

| File | What it does |
|------|-------------|
| [`scripts/public-sync.js`](scripts/public-sync.js) | The sync script — reads changed files, checks tags, calls GitHub API |
| [`.github/workflows/sync-to-private.yml`](.github/workflows/sync-to-private.yml) | Workflow that runs on push and syncs back to `private-monorepo` |

The sync script is identical in both repos. All the logic lives in one place.

---

## Testing the reverse direction (Public → Private)

1. Edit any text in [`docs/getting-started.mdx`](docs/getting-started.mdx) or [`docs/api-overview.mdx`](docs/api-overview.mdx)
2. Commit and push to `main`
3. Watch the [Actions tab](https://github.com/DeweyMarco/public-docs/actions) — the `Sync docs → private-monorepo` workflow runs
4. Check [`private-monorepo/docs/`](https://github.com/DeweyMarco/private-monorepo/tree/main/docs) — your change should appear under a `[sync] ...` commit
5. Check [private-monorepo Actions](https://github.com/DeweyMarco/private-monorepo/actions) — its workflow triggers but is **skipped** (anti-loop guard)

For the full demo walkthrough and all test cases, see the
[private-monorepo README](https://github.com/DeweyMarco/private-monorepo#readme).
