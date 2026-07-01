# Deploying to Vercel

You can deploy in **two ways**. Pick one — do not mix the settings.

---

## Option A — Two separate Vercel projects (recommended)

Use this if you created one project for the frontend and one for the backend.

### Frontend project

| Setting | Value |
|--------|--------|
| **Root Directory** | `frontend` |
| **Framework Preset** | **Vite** (not Services) |
| **Build Command** | `npm run build` |
| **Output Directory** | `dist` |

Environment variables:

- `VITE_API_URL` = your backend URL, e.g. `https://job-url-copier-api.vercel.app` (no trailing slash)

Uses `frontend/vercel.json` (SPA rewrites only).

### Backend project

| Setting | Value |
|--------|--------|
| **Root Directory** | `backend` |
| **Framework Preset** | **Other** (not Services) |
| **Install Command** | `npm install` |

Environment variables (from `backend/.env.example`):

- `MONGODB_URI`, `JWT_SECRET`, `API_KEY`, `CORS_ORIGIN`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, etc.
- `CORS_ORIGIN` = your frontend URL, e.g. `https://your-frontend.vercel.app`

Uses `backend/vercel.json` (routes all requests to the serverless `api/index.js` handler).

### Fix for “framework is set to services” error

If you see:

> Project framework is set to "services", but no services are declared

Your project Framework is set to **Services** but you are deploying only `frontend/` or `backend/`.

**Fix:** Vercel → Project → Settings → Build & Deployment → **Framework Preset** → set to **Vite** (frontend) or **Other** (backend).

---

## Option B — One Vercel project (monorepo Services)

Deploy the **repository root** (Root Directory must be empty / `.`).

| Setting | Value |
|--------|--------|
| **Root Directory** | *(leave empty)* |
| **Framework Preset** | **Services** |

Uses root `vercel.json`:

- `frontend` service → Vite app at `/`
- `backend` service → Express API at `/api/*`

Environment variables: set backend vars on the project. For the frontend, **leave `VITE_API_URL` unset** so the dashboard calls `/api` on the same domain.

Redeploy after changing Root Directory or Framework Preset.

---

## Google OAuth

Add your frontend origin under **Authorized JavaScript origins** in Google Cloud Console:

- `https://your-frontend.vercel.app`
- `http://localhost:5173` (local dev)
