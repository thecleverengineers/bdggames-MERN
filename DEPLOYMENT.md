# Production deployment with PM2

The server exposes the React application, REST API, Socket.IO endpoint and retained UI artwork on one port. Run exactly one PM2 instance until a shared game-scheduler lock and Socket.IO adapter have been added.

## Server prerequisites

- Ubuntu 22.04/24.04, Node.js 20.19+ and MongoDB 7+ (or MongoDB Atlas).
- A domain pointed at the server, with TLS terminated by Nginx or a comparable proxy.
- A long random JWT secret. Generate one with `openssl rand -base64 48`.

## Render Blueprint

The repository root contains `render.yaml`. Create a Render Blueprint from this repository and provide the requested Atlas `MONGODB_URI`, administrator email and administrator password as secret environment variables. Render generates `JWT_SECRET`, uses the injected `PORT`, and builds the React client before starting the Node service. Its Render-specific startup command syncs MongoDB indexes and seeds/updates the configured administrator before starting the API. The server automatically permits its own `onrender.com` origin; after adding a custom domain, set `CLIENT_ORIGIN` to that HTTPS domain and redeploy.

## Install and configure

```bash
git clone https://github.com/thecleverengineers/bdggames-MERN.git
cd bdggames-MERN
npm install
npm --prefix client install
cp .env.example .env
```

Set these production values in the untracked `.env` file. Do not commit it:

```dotenv
NODE_ENV=production
PORT=5000
CLIENT_ORIGIN=https://games.example.com
MONGODB_URI=mongodb+srv://.../bdggames
JWT_SECRET=replace-with-a-48-byte-random-secret
COOKIE_SECURE=true
APP_MODE=demo
REAL_MONEY_ENABLED=false
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=replace-with-a-strong-password
```

Create indexes and the first administrator only on a fresh database, then build and start the service:

```bash
npm run db:indexes
npm run seed
npm run build
npm install --global pm2
pm2 start ecosystem.config.cjs --env production
pm2 save
pm2 startup
```

Run the command printed by `pm2 startup` to enable restarts after a server reboot. Verify the application before opening it to users:

```bash
pm2 status
pm2 logs bdggames-mern
curl http://127.0.0.1:5000/api/health
```

## Nginx reverse proxy

Use a TLS certificate before setting `COOKIE_SECURE=true`. The following virtual host forwards standard HTTP and Socket.IO upgrades:

```nginx
server {
    listen 80;
    server_name games.example.com;

    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

After enabling TLS, set `CLIENT_ORIGIN` to the HTTPS domain and reload Nginx.

## Release procedure

```bash
git pull --ff-only origin main
npm install
npm --prefix client install
npm run build
pm2 reload ecosystem.config.cjs --env production --update-env
```

Back up MongoDB before schema/data changes. If importing legacy MySQL data, follow [MIGRATION.md](MIGRATION.md) and run the importer exactly once in a maintenance window.

## Real-money status

This codebase deploys in demo mode. Do not set `REAL_MONEY_ENABLED=true` based only on this repository: it has no live payment gateway or licensed game-provider integration. A regulated launch also requires jurisdictional licensing, age gating, KYC/AML, self-exclusion and responsible-gaming controls, payment-provider approval, independently audited games, transaction monitoring and incident/audit retention.
