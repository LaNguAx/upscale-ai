# `@repo/eslint-config`

Shared ESLint configurations for `agentbase`.

This package is the source of truth for the repo's lint baseline. App-level configs should layer on top of these shared exports instead of re-creating their own standards.

## Exports

- `@repo/eslint-config/base`
- `@repo/eslint-config/node`
- `@repo/eslint-config/react-internal`

## Guidance

- Prefer tightening rules here instead of drifting per app
- Keep the baseline generic enough to reuse across new projects started from this repo
- When the shared lint contract changes, update the root docs and agent guidance too
