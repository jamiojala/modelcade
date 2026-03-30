# Contributing to `@jamiojala/modelcade`

Thanks for contributing. We want `modelcade` to stay small, predictable, and high-signal.

## Prerequisites

- Node.js `>=18`
- `pnpm` (latest)

## Setup

```bash
pnpm install
pnpm test
pnpm build
```

## Scripts

- `pnpm test` run unit tests with Vitest
- `pnpm dev` run Vitest in watch mode
- `pnpm typecheck` run strict TypeScript checking
- `pnpm build` build distributable package with tsup
- `pnpm changeset` create a release note entry

## Workflow

1. Create a branch.
2. Make focused changes with tests.
3. Run `pnpm typecheck`, `pnpm test`, and `pnpm build`.
4. Add a changeset (`pnpm changeset`) for any user-facing change.
5. Open a PR.

## Guidelines

- Keep public APIs explicit and typed.
- Prefer additive changes over breaking changes.
- Normalize behavior in the gateway rather than in app code.
- Add tests for fallback, streaming, and tool-call edge cases.

## Changesets + Releases

This repository uses [Changesets](https://github.com/changesets/changesets).

- PRs should include at least one `.changeset/*.md` file for user-visible changes.
- Merging into `main` triggers the release workflow.
- Release publishing expects `NPM_TOKEN` in repository secrets.

## Security

Do not commit API keys or tokens. Use environment variables in local examples.
