# Studio Recovio — staff backend

Fastify + TypeScript + Neon/PostgreSQL, with an Italian staff portal served by the same process. This project is independent of the public Next.js site in `../Therapy`.

## Included

- Administrator and doctor login; no public account registration or client-selected roles.
- Administrator creates, updates and deactivates doctor accounts, resets temporary passwords, reviews all applications and assigns them to doctors.
- Doctors see only assigned applications and update their progress: **Nuova → In lavorazione → Contattata → Chiusa**. Statuses can be corrected; closing a request does not confirm a scheduled appointment.
- All new consultation, service, information and rental requests enter the admin queue. A patient's preferred professional is retained as a preference, not an automatic assignment.
- Responsive portal, first-login password change, password settings, pagination, status/assignment filters and administrator activity log.
- Existing public booking form submits to the API and shows a reference. Retry keys prevent duplicate submissions after a lost response.

## Local setup

Requires Node 24 and pnpm 10.34.1. From this folder:

```powershell
pnpm install --frozen-lockfile
Copy-Item .env.example .env
# Set DATABASE_URL and the local URLs in .env.
pnpm db:inspect
pnpm db:migrate
pnpm admin:create
pnpm build
pnpm start
```

The working local `.env` and first administrator have already been configured on this machine. **Do not overwrite that `.env` or run the administrator creation command again for the same account.**

- Staff portal: `http://localhost:4000/login`
- Public site preview: `http://localhost:3003`
- Initial email: `admin@studiorecovio.example`
- Initial password: `.local/admin-credentials.txt` — generated, never printed in logs or committed. Change it at first login, save the new password securely and delete the handoff file.
- Development watch mode: `pnpm dev`

Only the administrator is seeded. No real doctor or patient records are created. Doctor credentials are shown once to the administrator; share them manually through an appropriate private channel. No email or WhatsApp messages are sent by this implementation.

## Connect the public website

The public site has a build-time setting in `../Therapy/.env.local`:

```dotenv
NEXT_PUBLIC_STAFF_API_URL=http://localhost:4000
```

This URL is public; **never put the database connection string in a `NEXT_PUBLIC_` variable**. It enables the booking endpoint and an “Area riservata” link in the content-page footer. When omitted, booking keeps the existing unsent preview behavior. Rebuild the public site after changing the URL. Submission requires JavaScript; browsing remains available without it.

## Configuration and deployment

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Server-only Neon connection string; `.env` locally, host secret in production |
| `DB_SCHEMA` | Dedicated schema, defaults to `studio_recovio` |
| `PORTAL_ORIGIN` | Exact external portal origin; required for login and authenticated writes |
| `WEBSITE_ORIGINS` | Comma-separated origins allowed to submit public requests |
| `WEBSITE_URL` | Public-site return link |
| `NODE_ENV` | `production` requires HTTPS and enables Secure session cookies |
| `HOST`, `PORT` | `127.0.0.1:4000` locally; use `0.0.0.0` on a container host |
| `TRUST_PROXY` | Exact trusted proxy IP/CIDR list; empty by default. Do not trust arbitrary forwarding headers |
| `APPLICATIONS_ENABLED` | Enabled locally; **disabled by default in production** until explicitly set to `true` |

Run this backend on a Node 24 host, separate from the existing static Cloudflare site. Set the API's HTTPS origin in the website's build environment and rebuild that site. Auth cookies remain on the portal origin; the public form sends no auth cookies. Serve the portal directly at its configured origin, without an extra path prefix.

Before public intake, supply the clinic-approved privacy notice currently missing from `/privacy`, agree retention/access procedures and explicitly enable `APPLICATIONS_ENABLED=true`. Existing public contact details remain placeholders. This implementation is not a clinical record system or a confirmed appointment calendar.

Run migrations as a release step (`pnpm db:migrate`), then start (`pnpm start`). Migrations are versioned, checksummed and transactional, using fully qualified schema names and transaction advisory locks compatible with Neon pooling. No table reset or automatic production seed occurs on startup. `/health` checks the process; `/ready` checks database connectivity.

The Dockerfile builds the backend and runs as an unprivileged user. A persistent filesystem is not required for runtime sessions; they are in Postgres. Supply environment variables through the host, not in the image. Migrations/admin bootstrap are separate local or release commands.

## Security model

- Parameterized SQL; all intake and account fields are validated with bounded, strict Zod schemas.
- Passwords use salted scrypt (`N=65536, r=8, p=2`); temporary passwords are random and must be changed before accessing patient requests.
- Random session tokens are stored only as SHA-256 digests in Postgres. Cookies are HttpOnly, SameSite=Lax and Secure with `__Host-` naming in production. Sessions expire after 12 hours.
- Login enforces the portal origin. Authenticated writes also require a session-bound CSRF token. No auth token or patient record is persisted in localStorage.
- Password changes, resets and account deactivation revoke sessions. All record access and role checks occur on the server. Application updates use a version field to reject stale writes.
- Login failures are tracked in Postgres across restarts: 10 failures in 15 minutes lock that identifier for 15 minutes. Additional per-IP limits protect login and public intake.
- The per-IP limiter is local to a single Node process. Before using multiple replicas, put a shared limiter or trusted edge rate limit in front of them. Configure proxy trust for the actual host to avoid treating all visitors as one IP.
- Responses containing private data use `Cache-Control: no-store`. Portal responses are `noindex`. CSP restricts scripts/styles/connections to the portal. User content is escaped before rendering.
- Request bodies, credentials, session cookies and database error details are not logged. Audit events contain actor/target IDs and change metadata, not submitted notes or contact information.
- Verified TLS and channel binding are enabled for the database. Expired sessions are removed during session issuance. No appointment email, SMS, file upload or external analytics integration is installed.

Production database credentials should be managed by the hosting provider. Keep `.env`, `.local`, videos and all verification outputs out of repositories and public folders.

## API

All API responses are JSON. Requests with bodies use `Content-Type: application/json`. Private writes require the portal `Origin`, session cookie and `X-CSRF-Token` returned by login/`me`.

| Method/path | Access / purpose |
| --- | --- |
| `POST /api/auth/login` | Email + password; sets cookie, returns safe user data and CSRF token |
| `GET /api/auth/me` | Current user and CSRF token; allowed during mandatory password change |
| `POST /api/auth/password` | `currentPassword`, `newPassword` (12–128 characters); rotates sessions |
| `POST /api/auth/logout` | Deletes current session and clears cookie |
| `GET /api/dashboard` | Counts scoped to the logged-in role |
| `GET /api/applications` | Paginated list; `page`, `limit` (max 50), `status`, `assignment=all\|unassigned` |
| `GET /api/applications/:id` | Details; admin or assigned doctor only |
| `PATCH /api/applications/:id` | `{status, version}`; admin or assigned doctor |
| `PUT /api/applications/:id/assignment` | `{doctorId: UUID\|null, version}`; admin only |
| `GET /api/admin/doctors` | Doctor list, never password hashes or tokens |
| `POST /api/admin/doctors` | `{name,email}`; returns a generated temporary password once |
| `PATCH /api/admin/doctors/:id` | `{name,email,active}`; revokes that doctor's sessions |
| `POST /api/admin/doctors/:id/reset-password` | New temporary password; revokes sessions |
| `GET /api/admin/audit?page=1` | Audit log, 50 events per page |
| `POST /api/public/applications` | Public intake from allowed site origins; `Idempotency-Key` UUID required |

Intake accepts the existing website form: `tipo`, optional `servizio`, `dove`, `professionista`, rental `dispositivo`/`periodo`, `giorni`, `fasce`, `subito`, `nome`, `telefono`, optional `email`, `contatto`, optional `perAltraPersona`/`note`, `privacy:true` and an empty `sito` honeypot. Supported enums and maximum lengths are in `src/validation.ts`. Returns only a receipt reference, never a public endpoint to retrieve patient information.

## Validation

```powershell
pnpm typecheck
pnpm build
pnpm test
# With backend on 4000 and the connected static site on 3003:
pnpm verify:browser
```

`pnpm test` uses the configured Neon database but creates a uniquely named `recovio_test_*` schema, verifies its name before cleanup and drops only that test schema. Tests cover auth, permissions, first-login changes, revocation, CSRF/origin checks, consent, duplicate requests, assignment, concurrent edits, lockouts and production cookie flags.

Browser verification uses synthetic accounts and a synthetic booking, exercises the actual website → API → Neon → admin → doctor flow, and removes only those synthetic rows afterward. Chrome desktop/phone and WebKit desktop are automated browser checks, not physical-device testing. Screenshots, motion and accessibility results stay in ignored `verification/`.

The existing Next.js build reports a pre-existing security upgrade warning. The backend does not update that framework. Review that separate dependency issue before publishing the integrated public site.

Implementation references: [Fastify validation](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/), [Fastify cookies](https://github.com/fastify/fastify-cookie), [node-postgres TLS and channel binding](https://node-postgres.com/features/ssl).
