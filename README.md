# Quality Dashboard

This is a read-only dashboard for Jira and Zephyr Cloud. It starts with a secure connection page, discovers every Jira space available to the supplied account, and displays delivery health, PI and sprint analytics, an epic-first work-item hierarchy, and Zephyr quality.

## Start it

1. Run `npm start` and open `http://localhost:4173`.
2. Enter the Jira Cloud URL, Jira email, Jira API token, Zephyr region, and Zephyr API token on the connection page.
3. After both services validate, choose any accessible Jira space from the always-visible selector.

Credentials live only in server memory for the current browser session. The HTTP-only session cookie expires after one hour, credentials are never saved to disk or returned to the browser, and Disconnect removes the server-side session immediately.

## Space, PI, and sprint configuration

- Jira spaces are discovered automatically using the connected Jira account's Browse Projects access.
- `JIRA_PI_FIELD_ID` identifies the Jira `PI` multi-select field. The dashboard-demo field is `customfield_10074`.
- `JIRA_SPRINT_FIELD_ID` identifies the Jira `Sprints` multi-select field. The dashboard-demo field is `customfield_10075`.
- The program view presents four PIs and six sprints per PI. Delivery metrics are calculated from the first PI and sprint value assigned to each non-epic work item.
- Assignment warnings identify missing values, multiple selections, and cases where the sprint belongs to a different PI.
- PI and sprint status cards come from each Jira space's Story workflow. New Jira statuses appear automatically, including statuses with zero assigned stories.
- The selected space is stored in the URL as `?space=DD`, so overview, epic, and quality links remain space-specific and can be shared.
- `GET /api/dashboard?space=DD` returns the selected space, the full configured space list, PI/sprint analytics, delivery metrics, epics, work items, and Zephyr quality data.
- `GET /api/spaces` returns the configured space keys for lightweight discovery.

Without an active connection session, the dashboard returns to the connection page.

## Live Jira permissions

The Atlassian account backing the token needs only **Browse Projects** permission for the spaces it should display. Jira Cloud URLs are restricted to HTTPS `*.atlassian.net` hosts.

## Live Zephyr Cloud connection

The server reads Zephyr Cloud directly from its regional REST API. It loads test cases, test cycles, test plans, executions, and status definitions for the selected Jira space, then calculates the live pass/fail/blocked breakdown. After connection, the API token is used only by the server and is never returned to the browser.

If the Zephyr API is unavailable, Jira delivery data remains usable and the quality panel clearly reports the Zephyr sync error instead of presenting placeholder data as live.

## Deploy on Render

Create a Render Blueprint from this repository. Render uses `render.yaml` to create the Node web service, run its health check, and publish the dashboard over HTTPS. Client credentials are entered only on the connection page and remain in the running service's memory for one hour.
