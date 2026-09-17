# Quality Dashboard

This is a read-only dashboard for the DD Jira space. It displays delivery health, PI and sprint analytics, an epic-first work-item hierarchy, and Zephyr quality.

## Start it

1. Copy `.env.example` to `.env`.
2. Set `JIRA_EMAIL`, a read-only `JIRA_API_TOKEN`, and `ZEPHYR_API_TOKEN`. Keep these values private; `.env` is not committed.
3. Run `npm start` and open `http://localhost:4173`.

## First-release configuration

- The Jira site, DD space, PI/sprint fields, and Zephyr EU endpoint are fixed defaults for this release.
- Space switching and region selection are intentionally hidden. The underlying support remains in the code for a future version.
- The program view presents four PIs and six sprints per PI. Delivery metrics are calculated from the first PI and sprint value assigned to each non-epic work item.
- Assignment warnings identify missing values, multiple selections, and cases where the sprint belongs to a different PI.
- PI and sprint status cards come from each Jira space's Story workflow. New Jira statuses appear automatically, including statuses with zero assigned stories.
- `GET /api/dashboard?space=DD` returns the selected space, the full configured space list, PI/sprint analytics, delivery metrics, epics, work items, and Zephyr quality data.
- `GET /api/spaces` returns the configured space keys for lightweight discovery.

Without credentials, the dashboard intentionally uses a verified local snapshot of Epic `DD-1`; the UI is still fully usable.

## Live Jira permissions

The Atlassian account backing the token needs only **Browse Projects** permission for the configured spaces. The server calls Jira from the local machine; credentials are never exposed to the browser.

## Live Zephyr Cloud connection

The server reads Zephyr Cloud directly from its regional REST API. It loads test cases, test cycles, test plans, executions, and status definitions for `JIRA_PROJECT_KEY`, then calculates the live pass/fail/blocked breakdown. The API token is used only by the local server and is never sent to the browser.

If the Zephyr API is unavailable, Jira delivery data remains usable and the quality panel clearly reports the Zephyr sync error instead of presenting placeholder data as live.

## Deploy on Render

Create a Render Blueprint from this repository and provide only `JIRA_EMAIL`, `JIRA_API_TOKEN`, and `ZEPHYR_API_TOKEN` when prompted. The Jira site, DD space, and Zephyr EU endpoint are already fixed in `render.yaml`. Render creates the Node web service, runs its health check, and publishes the dashboard over HTTPS. Keep `.env` local; hosted credentials belong in Render's secret environment settings.
