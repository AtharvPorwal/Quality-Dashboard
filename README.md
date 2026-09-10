# Quality Dashboard

This is a local, read-only dashboard for Jira spaces. It displays delivery health, PI and sprint analytics, an epic-first work-item hierarchy, and Zephyr quality for the selected space.

## Start it

1. Copy `.env.example` to `.env`.
2. For a live Jira connection, set `JIRA_EMAIL` and a read-only Jira API token in `.env`. Keep the token private; `.env` is not committed.
3. Set `ZEPHYR_API_BASE_URL` and `ZEPHYR_API_TOKEN` to enable the live Zephyr Cloud quality metrics. This tenant uses the EU API base URL.
4. Run `npm start` and open `http://localhost:4173`.

## Space, PI, and sprint configuration

- Set `JIRA_SPACE_KEYS` to a comma-separated list such as `DD,LP`. The first space is selected by default.
- `JIRA_PI_FIELD_ID` identifies the Jira `PI` multi-select field. The dashboard-demo field is `customfield_10074`.
- `JIRA_SPRINT_FIELD_ID` identifies the Jira `Sprints` multi-select field. The dashboard-demo field is `customfield_10075`.
- The program view presents four PIs and six sprints per PI. Delivery metrics are calculated from the first PI and sprint value assigned to each non-epic work item.
- Assignment warnings identify missing values, multiple selections, and cases where the sprint belongs to a different PI.
- PI and sprint status cards come from each Jira space's Story workflow. New Jira statuses appear automatically, including statuses with zero assigned stories.
- The selected space is stored in the URL as `?space=DD`, so overview, epic, and quality links remain space-specific and can be shared.
- `GET /api/dashboard?space=DD` returns the selected space, the full configured space list, PI/sprint analytics, delivery metrics, epics, work items, and Zephyr quality data.
- `GET /api/spaces` returns the configured space keys for lightweight discovery.

Without credentials, the dashboard intentionally uses a verified local snapshot of Epic `DD-1`; the UI is still fully usable.

## Live Jira permissions

The Atlassian account backing the token needs only **Browse Projects** permission for the configured spaces. The server calls Jira from the local machine; credentials are never exposed to the browser.

## Live Zephyr Cloud connection

The server reads Zephyr Cloud directly from its regional REST API. It loads test cases, test cycles, test plans, executions, and status definitions for `JIRA_PROJECT_KEY`, then calculates the live pass/fail/blocked breakdown. The API token is used only by the local server and is never sent to the browser.

If the Zephyr API is unavailable, Jira delivery data remains usable and the quality panel clearly reports the Zephyr sync error instead of presenting placeholder data as live.

## Deploy on Render

Create a Render Blueprint from this repository and provide the six Jira/Zephyr environment variables when prompted. Render uses `render.yaml` to create the Node web service, run its health check, and publish the dashboard over HTTPS. Keep `.env` local; hosted credentials belong in Render's secret environment settings.
