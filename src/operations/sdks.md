# Client SDKs (Python + TypeScript)

DataShuttle ships two officially-supported client SDKs, both
**auto-generated from the server's OpenAPI 3.1 spec** so the types
stay in lock-step with every release.

| Language   | Package                     | Install                                  |
|------------|-----------------------------|------------------------------------------|
| Python     | `datashuttle-sdk`           | `pip install datashuttle-sdk`            |
| TypeScript | `@datashuttle/sdk`          | `npm install @datashuttle/sdk`           |

## Why generate?

The alternative — hand-rolling a client — guarantees drift between
server and clients the moment you ship a new endpoint. The Rust API
server uses [`utoipa`](https://docs.rs/utoipa) to derive an OpenAPI
document from the same handler signatures that serve the API. On each
tagged release the CI workflow
[`publish-sdks.yaml`](../../../.github/workflows/publish-sdks.yaml)
boots the server, captures `/api/openapi.json`, runs the per-language
generator, and pushes the resulting package to PyPI / npm.

## Python

```python
from datashuttle_sdk import Client

client = Client(
    base_url="https://api.datashuttle.ai",
    token="eyJhbGciOi...",
)

for pipeline in client.pipelines.list():
    print(pipeline.name, pipeline.state)
```

Supports Python 3.9+. Built on `httpx`; works in both sync and async
code.

## TypeScript

```ts
import { DataShuttleClient } from "@datashuttle/sdk";

const client = new DataShuttleClient({
  BASE: "https://api.datashuttle.ai",
  TOKEN: process.env.DATASHUTTLE_TOKEN,
});

const pipelines = await client.pipelines.listPipelines();
console.log(pipelines);
```

ESM and CJS builds are published; works in Node 18+ and modern
browsers.

## Versioning policy

**SDK version tracks the server version.** A server at version
`X.Y.Z` publishes SDKs at `X.Y.Z`. Patch and minor SDK releases are
backward-compatible with any server `>= X.Y.0 < (X+1).0.0`. A major
server bump also bumps both SDK majors.

There is no "latest SDK works against any server" compatibility
promise — pin the SDK to the same majors as your server.

## Where the OpenAPI spec lives

- **Live (every running server):** `GET /api/openapi.json`
- **Browsable reference:** `GET /docs/api/` (Swagger UI)
- **Source of truth:**
  [`crates/datashuttle-api/src/openapi.rs`](../../../crates/datashuttle-api/src/openapi.rs)
  — compile-time-assembled from `#[utoipa::path]` attributes on the
  handlers.

### Regenerate locally

If you want to preview the SDK against an unreleased server, spin up
the server on port 8080 and run the generator scripts:

```bash
# Python
cd sdk/python
bash scripts/generate.sh                  # reads localhost:8080
make test

# TypeScript
cd sdk/typescript
npm install
bash scripts/generate.sh                  # reads localhost:8080
npm run build
npm test
```

Both scripts accept an explicit path to the spec for air-gapped
workflows:

```bash
bash scripts/generate.sh /path/to/openapi.json
```

## Release automation

[`publish-sdks.yaml`](../../../.github/workflows/publish-sdks.yaml) runs
on `release: published` **and** `workflow_dispatch` (so ops can retry a
failed publish without cutting a new release). It needs two repo
secrets:

- `PYPI_TOKEN` — PyPI API token with upload rights on
  `datashuttle-sdk`.
- `NPM_TOKEN` — npm automation token with publish rights on
  `@datashuttle/sdk`.

If either secret is missing the workflow fails fast with an actionable
error.
