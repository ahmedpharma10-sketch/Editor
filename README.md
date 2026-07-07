# Diffusion Studio

Open-source video editor: a SolidJS web app with an ECS-based engine, an
Electron desktop wrapper, and a CLI. Talks to the Diffusion Studio backend
through the published [`@diffusionstudio/api-contract`](https://www.npmjs.com/package/@diffusionstudio/api-contract)
package.

## Structure

```
apps/
  web/        SolidJS + Vite SPA (the editor)
  desktop/    Electron desktop app (wraps the web app)
  cli/        CLI (`dapi`) and IPC protocol shared with desktop
```

## Getting Started

Requires [Node.js](https://nodejs.org) v20+.

```bash
npm install
cp apps/web/.env.example apps/web/.env
npm run dev          # web app → http://localhost:5173
```

All values in `.env.example` are public; the defaults point the app at the
production API, so no local backend is needed. To develop against a local
backend instead, set `VITE_API_URL=http://localhost:3000` in `apps/web/.env`
(or leave it empty to use the Vite dev proxy, which forwards `/api` to
`http://localhost:3000`).

### Desktop App

The Electron app loads the web dev server in development:

```bash
npm run dev          # terminal 1
npm run dev:desktop  # terminal 2
```

### Build

```bash
npm run build:web      # static build → apps/web/dist
npm run build:desktop
npm run make           # package the desktop app
```

### Type Checking & Linting

```bash
npm run check
npm run lint
```

## Deployment

The web app is a static Vite build deployed on Vercel. Project settings:

- **Root Directory**: `apps/web` (Vercel detects the npm workspace and
  installs from the repo root, which the `@diffusionstudio/cli` workspace
  dependency requires)
- Everything else comes from `apps/web/vercel.json`: SPA rewrites, the
  COOP/COEP headers required for SharedArrayBuffer, and a build command that
  copies `.env.example` to `.env` so the public defaults apply.

To override build-time config (API URL, Supabase, analytics), set the
corresponding `VITE_*` variables in the Vercel dashboard — process env takes
precedence over the copied `.env` defaults.

## License

This project is licensed under the [Mozilla Public License 2.0](LICENSE).
