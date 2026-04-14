# UI Architecture

This document describes the DataShuttle frontend architecture as of
Phase 7 of the SaaS rollout (#559, tasks 7.1 + 7.2). It covers the API
client, auth state management, and how to add new pages.

## API Client (`ui/src/api.ts`)

A single typed `api` object exposes every HTTP call the UI needs.
Under the hood, one `call<T>()` wrapper owns:

- `credentials: 'include'` on every request, so the HttpOnly session
  cookie travels with browser calls.
- The legacy Basic-auth header (from on-prem `#236`) as a fallback when
  `sessionStorage` holds `ds_auth` — lets the same client serve
  both SaaS and on-prem deployments.
- JSON body encoding (`Content-Type: application/json` auto-attached).
- Error normalization into the `ApiError` class:

  ```ts
  try { await api.subscribe("pro"); }
  catch (e) {
    if (e instanceof ApiError && e.status === 429) { /* rate limited */ }
  }
  ```

- 401 handling: any 401 on a non-auth endpoint clears stored
  credentials and redirects the browser to `/login`.

### Adding a new endpoint

Extend the `api` object in `ui/src/api.ts`:

```ts
export const api = {
  // ...
  async listWidgets(): Promise<Widget[]> {
    return call("GET", "/widgets");
  },
};
```

Add an interface for the response type and — if you care about
specific error shapes — type-guard the `ApiError.details` field.

### Base URL

`VITE_API_BASE` overrides `/api/v1`; tests and non-standard hosting
(e.g. a reverse-proxy prefix) can set it at build time.

## Auth State (`ui/src/auth/`)

```
ui/src/auth/
├── AuthProvider.tsx   // React context + provider
├── RequireAuth.tsx    // Route guards: RequireAuth, RequireRole
└── index.ts           // Public barrel
```

### `AuthProvider`

Holds `{ user, tenant, org, loading, error }`. On mount it calls
`api.getCurrentUser()` (cookie-authenticated) to resurrect the session.
Actions:

- `login(email, password)` — posts to `/auth/login`, then refreshes
  state from `/users/me` + `/tenants/me`.
- `signup(input)` — posts to `/auth/register`. Does **not** log the
  user in; caller should redirect to `/verify-email` or `/onboarding`.
- `logout()` — posts to `/auth/logout` and clears local state.
- `refresh()` — re-fetches `/users/me` + `/tenants/me`.

### `RequireAuth` / `RequireRole`

Route guards. `RequireAuth` shows a spinner while the provider is
loading, then renders children if `user` is truthy, else redirects to
`/login` (preserving the intended destination in `location.state.from`
so the login page can bounce the user back on success).

`RequireRole role="admin"` is the same guard plus a role check against
`user.roles`; unauthorized users are redirected to `/forbidden`.

## Adding a new authenticated page

1. Create `ui/src/pages/MyPage.tsx` — use `useAuth()` if you need
   access to the current user/tenant.
2. Import it in `ui/src/App.tsx` and add a `<Route>` **inside** the
   `<RequireAuth><Layout /></RequireAuth>` block:

   ```tsx
   <Route path="/my-page" element={<MyPage />} />
   ```

3. To restrict to admins, wrap the element with `RequireRole`:

   ```tsx
   <Route
     path="/admin/things"
     element={
       <RequireRole role="admin">
         <AdminThings />
       </RequireRole>
     }
   />
   ```

## Testing

Vitest + MSW is configured out of the box. Run `npm test` (one-shot)
or `npm run test:watch` inside `ui/`. See
`ui/src/__tests__/api.test.ts` for the reference pattern:

- Wildcard MSW handlers (`*/api/v1/...`) so the test doesn't depend on
  the jsdom host.
- Each handler captures `request.url`, `request.method`, and
  `request.credentials` into a `seen[]` array so assertions can check
  that cookies travel with the request.

## Legacy compatibility

`useAuth()` exposes `{ username, isAuthenticated, authMode }` in
addition to the new SaaS fields, so pre-existing components
(`Layout.tsx`, etc.) keep working while the UI migrates to the new
shape.
