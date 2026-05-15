# Contributing

DataShuttle's source is developed in a private repository; the public
product repo (<https://github.com/datashuttle-io/datashuttle>) carries
binaries, the Helm chart, and the docker image only. External
contribution is by invitation — file bug reports against that repo's
Issues tab or email the team at <hello@datashuttle.ai>.

This page captures the headline expectations the core team uses
internally; they also apply to any in-scope external contributions.

## Coding style

- **Rust**: `cargo fmt` + `cargo clippy -- -D warnings` must pass.
  Crate-local lints are scoped in each crate's `lib.rs`; don't weaken
  a workspace-wide lint without sign-off from a maintainer.
- **TypeScript / React**: `npm run lint` + `npm run typecheck` must
  pass. The `@/ui` shim is the only import root for shared UI
  primitives; avoid deep-importing `datashuttle-ui` internals.
- **SQL migrations**: one feature per migration file, numbered
  sequentially. Migrations are applied by sqlx on boot and must be
  idempotent (use `IF NOT EXISTS` / `ALTER TABLE … ADD COLUMN IF NOT
  EXISTS` so re-running is safe).

## Commits

- One logical change per commit. Bug-fix + refactor in the same
  commit is a review blocker — split it.
- Issue references in the subject line: `feat(#123): …`,
  `fix(#456): …`, `docs(#789): …`. The parser that drives
  release-note generation relies on this format.
- The body explains the *why*; the diff shows the *what*.

## Tests

- New feature → at least one unit test pinning the public behaviour.
- Bug fix → a regression test that fails without your patch.
- Integration tests live under `crates/*/tests/` and `ui/src/__tests__/`.

## CI expectations

- Rust: `cargo test --workspace` must be green. The saas-feature
  matrix (`--features saas`) is only enforced on crates that opt into
  it — check the matrix in `.github/workflows/ci.yaml` if unsure.
- UI: `npm test` green; Playwright snapshot tests live under
  `ui/e2e/`.

## Cloud-sensitive changes

Any change that touches `crates/datashuttle-api/src/handlers/users.rs`
or the control-plane migrations (`crates/datashuttle-control/migrations/`)
gets an extra review round. The deploy contract is:

1. Merge to `main`.
2. CI publishes the docker image.
3. `deploy/jarvis-cloud/docker-compose.yaml` is pulled on the next
   rolling restart (manual trigger for now).

## Reporting issues

Open a GitHub issue with repro steps, actual vs expected behaviour,
and the relevant portion of the server log (`RUST_LOG=info,datashuttle=debug`).
For security issues, do NOT open a public issue — email
`security@datashuttle.ai` instead.
