---
name: backlinks
description: Publish drafted press releases from the "Top Click Backlinks To-Do" Notion sheet to the TCBlogs Ghost blog (tcblogs.ghost.io) via the Ghost Admin API, then write the live URLs back into Notion and flip the rows to Published. Use when the user asks to "publish the ghost drafts", "push the drafts live", "publish the backlinks/press releases", or anything about taking drafted TCBlogs posts live.
---

# Backlinks: publish drafted press releases to Ghost (TCBlogs)

This skill takes press releases that the daily pipeline has **drafted** into the
Ghost blog and pushes them **live**, then records the live links back in Notion.

## Key facts (don't re-derive these)

- **Ghost blog:** `https://tcblogs.ghost.io` (admin at `/ghost/`).
- **Notion control sheet:** "Top Click Backlinks To-Do"
  - Database: `https://app.notion.com/p/fce5cd00d59844ed900d196b6a614178`
  - Data source: `collection://08cafbb1-3f0a-4421-8599-8aac9bc28e67`
  - One row per press release (~82). Columns per month: a **status** column
    (`Jun 2026`, `Jul 2026`, …) and a matching **link** column (`Jun Link`,
    `Jul Link`, …). Status flow: `Pending → Approve → Drafted → Published`.
  - When a post is **Drafted**, its `{Month} Link` holds a Ghost *editor* URL
    like `https://tcblogs.ghost.io/ghost/#/editor/post/<POST_ID>` — the last
    path segment is the Ghost post id.
  - When **Published**, the link should be the **live** post URL
    (e.g. `https://tcblogs.ghost.io/<slug>/`).

## Auth (the one secret)

The Ghost **Admin API key** is in `id:secret` form. It is **never committed** —
it is read from the `GHOST_KEY` environment variable.

- Get it from: Ghost Admin → Settings → Integrations → the custom integration →
  **Admin API Key**.
- Set it permanently in the Claude Code environment settings as `GHOST_KEY`
  (and optionally `GHOST_URL`, which defaults to `https://tcblogs.ghost.io`).
- The admin **UI password** (in the "Link Building Process" Notion page) does
  **not** work for the API — only the Admin API key does.

## Procedure

1. **Find the drafts.** Query the control sheet for rows whose current-month
   status is `Drafted` (check the relevant month columns):
   ```sql
   SELECT "Client", "No.", "<Month>", "<Month> Link"
   FROM "collection://08cafbb1-3f0a-4421-8599-8aac9bc28e67"
   WHERE "<Month>" = 'Drafted'
   ```
   For each row capture: client name, the **Notion page id** (the row's `url`),
   the **month** column name, and the **Ghost post id** (last segment of the
   `{Month} Link` editor URL).

2. **Confirm scope** with the user (all drafts, or a subset) — these go live
   publicly, and the system rule is "nothing publishes without sign-off."

3. **Publish via the Admin API.** Write the captured rows to a JSON file and run
   the script (it mints a short-lived HS256 JWT from `GHOST_KEY` and PUTs
   `status: published` to each post, returning the live URL):
   ```bash
   GHOST_KEY="$GHOST_KEY" node .claude/skills/backlinks/scripts/publish_ghost.mjs posts.json
   ```
   `posts.json` is an array of `{ "client", "postId", "month", "notion" }`.
   If `GHOST_KEY` isn't set, ask the user to paste it once (then suggest saving
   it to the environment so this stays a one-time step).

4. **Record results in Notion.** For every post the script reports as
   `published` (or `already-published`), update that row via
   `notion-update-page` (update_properties on the row's page id):
   - set `"<Month>"` → `"Published"`
   - set `"<Month> Link"` → the live `url` returned by the script
   Report any `ERROR` rows back to the user with the message; don't touch their
   Notion status.

5. **Summarise**: list each client, its new live URL, and confirm the sheet was
   updated.

## Notes

- The script is idempotent: a post already `published` in Ghost is reported as
  `already-published` with its live URL (safe to re-record in Notion).
- Ghost requires the post's current `updated_at` on a PUT (collision check); the
  script fetches it first, so you never pass it manually.
- Run this from the server-side environment (no browser CORS limitation).
