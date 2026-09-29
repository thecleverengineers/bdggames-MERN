# Legend Casino MERN migration

The application is now split into a React client and a Node/Express/MongoDB API. The production repository contains a compact runtime artwork bundle in `public-assets`; it preserves the supplied logo, banner and game-card artwork without carrying the legacy server-rendered application or its large asset archive. The API serves this bundle directly.

## Start locally

1. Copy `.env.example` to a local `.env` file and set a MongoDB URI plus a long JWT secret.
2. Run `npm install` in the repository root, then `npm --prefix client install`.
3. On a new production database, run `npm run db:indexes` once to create the required unique and query indexes.
4. Create the first administrator with `npm run seed`.
5. Run `npm run dev` and open `http://localhost:5173`.

Use `npm run build` followed by `npm start` for production. The API serves the built React app and artwork from one service. For an Nginx + PM2 deployment, follow [DEPLOYMENT.md](DEPLOYMENT.md).

## Legacy MySQL import

1. Export and back up the MySQL database first. Never point the importer at the only copy of production data.
2. Add the `MYSQL_*` values to your local untracked `.env` file.
3. Run `npm run migrate:mysql` once, then verify player counts, wallet totals and samples of deposits, withdrawals and bets before switching traffic.

| Legacy table | MongoDB destination |
| --- | --- |
| `users` | `users` |
| `recharge` | `paymentrequests` + `wallettransactions` |
| `withdraw` | `paymentrequests` + `wallettransactions` |
| `minutes_1` | `gamerounds` + `bets` |

Legacy bcrypt hashes are preserved. Any other legacy password representation, especially a plaintext or MD5 value, is deliberately not imported; those users are flagged to reset their password after a verified SMS/email reset provider is configured.

## Operational and compliance controls

The default configuration is `APP_MODE=demo` and `REAL_MONEY_ENABLED=false`. The wallet, payment review and game interfaces are fully available for integration/testing, but no gateway is connected and no real-money processing should be activated by this code alone. Before any regulated launch, arrange legal review for each target jurisdiction and add: age gating, KYC/AML, self-exclusion and limits, a licensed payment provider, an independently audited RNG/game-provider integration, transaction monitoring, and incident/audit retention.

The repository previously contained tracked environment files and an OpenSSH private key. They are now excluded from future commits. Rotate every value and that SSH key before deployment; removing a file from a later commit does not remove it from Git history.
