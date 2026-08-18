# Deployment Guide

This repository is designed to deploy a blank API gateway instance from source.

## One-command Deployment

```bash
git clone <your-repository-url>
cd api-gateway-reseller
bash deploy.sh
```

The script will:

- create `.env` if it does not exist
- generate secure `JWT_SECRET` and database password values
- ask for the initial admin account
- ask for the public server IP/domain and write public API URLs into `.env`
- start Postgres and Redis with Docker Compose
- install dependencies
- run Prisma migrations with `migrate deploy`
- seed only the blank admin account, admin wallet, and required system settings
- build the API and web app
- start both services with PM2

## Blank Data Policy

The deployment seed intentionally does not create upstream providers, model prices, model pools, users, API keys, request logs, redeem codes, or transaction data.

After deployment, log in to the admin panel and configure:

1. Upstream providers
2. Per-model upstream pricing
3. Model pools and enabled channels
4. Users and balances

## Update Deployment

After pulling new code on the server:

```bash
bash deploy.sh --update
```

This keeps the existing `.env` and database data, then installs dependencies, applies migrations, rebuilds, and reloads PM2.

## Environment

Important variables live in `.env`:

- `DATABASE_URL`: PostgreSQL connection string
- `REDIS_URL`: Redis connection string
- `JWT_SECRET`: auth signing secret
- `ADMIN_EMAIL`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`: initial admin seed account
- `API_PORT`, `WEB_PORT`: service ports
- `NEXT_PUBLIC_API_BASE_URL`: browser-facing API URL
- `SECURITY_RESEARCH_SKILL_PUBLIC_ROOT`: public API-hosted root for the mirrored Security Research Skill, for example `https://gateway.example.com/security-research/current`; do not point this at a frontend-only domain unless that domain proxies this path to the API
- `CORS_ORIGINS`: comma-separated frontend origins allowed to call the API

Do not commit `.env` to GitHub.

For a public server, set `PUBLIC_API_BASE_URL` and `NEXT_PUBLIC_API_BASE_URL` to the public IP/domain, for example `http://YOUR_SERVER_IP:4100`, not `127.0.0.1`.

If you access the first deployment by server IP, make sure `CORS_ORIGINS` includes the frontend origin, for example `http://YOUR_SERVER_IP:4101`. The default `deploy.sh` flow adds this automatically when the public API base URL contains your server IP.

## PM2 Commands

```bash
pm2 status
pm2 logs api-gateway-api
pm2 logs api-gateway-web
pm2 restart api-gateway-api api-gateway-web
pm2 save
```

On some panel/custom Node environments, PM2 may be installed outside the shell `PATH`. `deploy.sh` locates PM2 through `command -v pm2`, `npm prefix -g`, and `npm bin -g`, then uses the absolute binary path.

## Nginx / Domain

The script does not automatically edit Nginx or SSL settings. If you use a domain, reverse proxy:

- frontend domain to `http://127.0.0.1:4101`
- API domain/path to `http://127.0.0.1:4100`

Then set `NEXT_PUBLIC_API_BASE_URL` in `.env` to the public API URL and rerun:

```bash
bash deploy.sh --update
```

## Backup

Use the optional scripts:

```bash
bash scripts/backup-db.sh
bash scripts/restore-db.sh backups/<file>.dump
```

Backup files are ignored by Git.
