# Quality Dashboard

This is a local, read-only dashboard for Jira project `DD`. It displays delivery health, an epic-first work-item hierarchy, and a Zephyr quality area.

## Start it

1. Copy `.env.example` to `.env`.
2. For a live Jira connection, set `JIRA_EMAIL` and a read-only Jira API token in `.env`. Keep the token private; `.env` is not committed.
3. Set `ZEPHYR_API_BASE_URL` and `ZEPHYR_API_TOKEN` to enable the live Zephyr Cloud quality metrics. This tenant uses the EU API base URL.
4. Run `npm start` and open `http://localhost:4173`.

Without credentials, the dashboard intentionally uses a verified local snapshot of Epic `DD-1`; the UI is still fully usable.

## Live Jira permissions

The Atlassian account backing the token needs only **Browse Projects** permission for `DD`. The server calls Jira from the local machine; credentials are never exposed to the browser.

## Live Zephyr Cloud connection

The server reads Zephyr Cloud directly from its regional REST API. It loads test cases, test cycles, test plans, executions, and status definitions for `JIRA_PROJECT_KEY`, then calculates the live pass/fail/blocked breakdown. The API token is used only by the local server and is never sent to the browser.

If the Zephyr API is unavailable, Jira delivery data remains usable and the quality panel clearly reports the Zephyr sync error instead of presenting placeholder data as live.

## Deploy on Render

Create a Render Blueprint from this repository and provide the six Jira/Zephyr environment variables when prompted. Render uses `render.yaml` to create the Node web service, run its health check, and publish the dashboard over HTTPS. Keep `.env` local; hosted credentials belong in Render's secret environment settings.
