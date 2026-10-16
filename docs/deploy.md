# Deploying the demo (Render)

The API can also serve the built web app, so the whole demo runs as **one Node web service**.

| Setting | Value |
| --- | --- |
| Runtime | Node (22 or newer; set `NODE_VERSION=22.22.0`) |
| Build command | `npm install && npm run build -w web` |
| Start command | `npm run start -w api` |
| Health check path | `/api/health` |
| `GREENSPARK_BASIC_AUTH` | `user:password`. Optional but recommended: the demo has no real sign-in, so without it anyone with the link can act as the manager. Health checks are exempt. Remove the variable to open the site up. |
| `GREENSPARK_PROFILE_URL_TEMPLATE` | Optional full-profile link, e.g. `https://profiles.example/people/{personId}` |

Render supplies `PORT`; the server listens on it.

## Things to know

- **Data is temporary on the free plan.** The SQLite file lives on the service's disk, which is wiped on every deploy and restart (free services also sleep after about 15 minutes idle). Each wake-up starts from the original 100 fictional cases. For data that survives, attach a paid persistent disk and set `GREENSPARK_DB` to a path on it.
- **Single instance only.** SQLite is a local file, so do not scale to more than one instance.
- **Auto-deploy** follows the branch you connect. Merge the pull request and switch the service to `main` when ready.
- Everything is fictional demo data. Do not load real customer data here.
