# BDG Games — MERN

Production-ready React, Express, MongoDB and Node.js migration of the original Legend Casino codebase. The existing Legend Games visual language and player flows are retained.

## Included

- React/Vite responsive client, retaining the supplied Legend Games artwork, blue/purple theme, banners, wallet and game-card patterns.
- Express API with secure cookie sessions, password hashing, role-based player/manager/admin access, validation, rate limiting, headers and CORS restrictions.
- MongoDB records for accounts, wallet ledger entries, deposit/withdrawal requests, provably committed demo rounds, bets, promotion claims and audit logs.
- Player workflows for sign-up/sign-in, profile/password management, wallet requests and transfers, Win Go/K3/5D demo betting, bet history, daily rewards and referrals.
- Admin workflows for operations dashboard, player list, wallet adjustments and payment-request approval/rejection.
- A one-way MySQL import command and a secure first-admin seed command.

## Quick start

```bash
cp .env.example .env
# Edit .env: MONGODB_URI, JWT_SECRET, ADMIN_EMAIL and ADMIN_PASSWORD
npm install
npm --prefix client install
npm run db:indexes
npm run seed
npm run dev
```

Open `http://localhost:5173`. For a PM2-managed production deployment, follow [DEPLOYMENT.md](DEPLOYMENT.md).

Read [MIGRATION.md](MIGRATION.md) before importing existing data or enabling any payment or partner-game provider. The project defaults to demo mode; live gambling/payment integrations are intentionally not enabled by this migration.
