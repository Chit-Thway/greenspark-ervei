# Deploy your ERVEI demo

The Dockerfile serves the API and built web app in one service. The full synthetic dataset is included compressed and unpacked during the image build. SQLite stores cases and group tasks, so mount persistent storage before using the app.

## Live Fly deployment

Live app: https://greenspark-ervei-chit-thway.fly.dev/

The app runs in Singapore (`sin`) on one 512 MB machine with an encrypted 1 GB `greenspark_data` volume mounted at `/data`. The machine suspends when idle and resumes on traffic. The reviewed sample forecast is the default; the Emergency WA feed is enabled.

To publish later changes after logging into your own Fly account:

```sh
fly deploy --app greenspark-ervei-chit-thway --remote-only --ha=false
```

GitHub pushes do not deploy automatically until the optional workflow credentials below are configured.

## Railway alternative

1. In Railway, create a project from `Chit-Thway/greenspark-ervei`, branch `main`, with the repository root as the service root. The committed `railway.toml` selects the Dockerfile and health check.
2. Attach a volume to this service at **`/data`**. Keep one replica because the app uses a single SQLite database.
3. Set these service variables:

   ```text
   PORT=3001
   GREENSPARK_DATASET=all
   GREENSPARK_DB=/data/greenspark.sqlite
   GREENSPARK_FLOW_FILE=/data/utility_hardship_mapping.json
   WEATHER_MODE=demo
   ```

4. Deploy, then generate a public domain targeting port **3001**. Check `/api/health`, the 4,309 forecast-covered customers, a group task, and that task after a restart.

`WEATHER_MODE=demo` reproduces the reviewed illustrative forecast, clearly labelled in the app. Use `live` to request current Bureau forecasts. Emergency WA is enabled by default; leave `EMERGENCY_FEED` unset. No AI key is required for the map or group tasks. Optional AI keys must be service secrets, never committed.

Railway requires an account and sufficient trial credit or a paid plan. See [Railway Dockerfiles](https://docs.railway.com/builds/dockerfiles) and [persistent volumes](https://docs.railway.com/volumes/reference).

## Fly.io alternative

The default app name is now `greenspark-ervei-chit-thway`; create an app in your own Fly organisation and use its actual available name. Attach a `greenspark_data` volume mounted at `/data`. To enable GitHub deployment, set repository variable `FLY_APP_NAME` to your own app and repository secret `FLY_API_TOKEN` to that app's deploy token. The workflow is skipped until the app variable is configured. It no longer implicitly targets the original shared deployment.
