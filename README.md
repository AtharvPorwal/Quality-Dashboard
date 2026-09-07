# DashBoard Demo delivery health dashboard

This is a local, read-only dashboard for Jira project `DD`. It displays delivery health, an epic-first work-item hierarchy, and a Zephyr quality area.

## Start it

1. Copy `.env.example` to `.env`.
2. For a live Jira connection, set `JIRA_EMAIL` and a read-only Jira API token in `.env`. Keep the token private; `.env` is not committed.
3. Run `npm start` and open `http://localhost:4173`.

Without credentials, the dashboard intentionally uses a verified local snapshot of Epic `DD-1`; the UI is still fully usable.

## Live Jira permissions

The Atlassian account backing the token needs only **Browse Projects** permission for `DD`. The server calls Jira from the local machine; credentials are never exposed to the browser.

## Zephyr note

The Jira page currently reports that no **Zephyr Enterprise** instance is configured, while the Jira project has Zephyr Cloud content. Confirm which Zephyr product/API is the source of truth before turning on the live adapter. The supplied `zephyr-demo-import.csv` contains eight draft cases, not the stated 829; it is therefore only identified as an import source, not presented as full coverage.
