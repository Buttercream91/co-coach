# Co-Coach

A web app for managing a soccer team — roster, match planning, formation editor, and (later) a live match runner.

This README covers **Phase 1**: project scaffold, auth, team & player management, match creation, and the formation editor with playtime-weighted autofill. Phase 2 (live match runner, timers, in-game subs, score & notes, cascading playtime recalc) is not built yet.

## Stack

| Layer | Tech |
|---|---|
| Client | React 18 + Vite + TypeScript, Tailwind CSS, React Router, TanStack Query |
| Server | Node 18 + Express + TypeScript, Drizzle ORM, JWT auth |
| Database | Postgres (Neon free tier for dev) |
| Repo layout | Sibling `client/` and `server/` directories, no workspace tooling |

## One-time setup

### 1. Get a Neon database (free)

1. Sign up at <https://neon.tech> (no credit card needed for the free tier).
2. Create a new project — pick any region near you.
3. From the project dashboard, copy the **Pooled connection** string. It looks like:
   ```
   postgresql://USER:PASSWORD@ep-xxx-pooler.REGION.aws.neon.tech/neondb?sslmode=require
   ```

### 2. Configure the server

```powershell
cd server
copy .env.example .env
```

Then edit `server/.env`:

- `DATABASE_URL` — paste the Neon connection string from step 1.
- `JWT_SECRET` — generate one:
  ```powershell
  node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
  ```
- `PORT` — leave at `3001` unless something else is using it.

### 3. Install dependencies

```powershell
cd server
npm install
cd ..\client
npm install
```

### 4. Generate and run the database migrations

From `server/`:

```powershell
npm run db:generate    # produces SQL in server/drizzle/
npm run db:migrate     # applies it to your Neon database
```

You only need to re-run `db:generate` when you change `server/src/db/schema.ts`. Re-run `db:migrate` after pulling new schema changes.

## Running locally

Two terminals:

```powershell
# Terminal A — API server (http://localhost:3001)
cd server
npm run dev
```

```powershell
# Terminal B — web client (http://localhost:5173)
cd client
npm run dev
```

The Vite dev server proxies `/api/*` to the API on port 3001 (see `client/vite.config.ts`), so the React app can just call `/api/...` paths.

## Using the app

1. Open <http://localhost:5173> and click **Create an account**.
2. After registering you'll be sent to the team-setup screen — either:
   - **Create team** (you become the owner), or
   - **Join team** with an invite code from another coach.
3. Add players on the **Players** tab. Set each player's season playtime if you're starting mid-season; the autofill uses it to decide who plays first.
4. Tap **+ New match** on the Matches tab to create a match. Pick the opposition, date, half length, sub-window count (3–5), available players, and a goalie.
5. After creating, you land in the **formation editor**. Each tab is one game segment (for 3 sub windows → 4 segments). For each tab:
   - Pick a formation (4-3-1, 4-2-2, 3-4-1, 3-3-2 for 9-player matches).
   - Tap any jersey on the pitch to swap who plays there. Tap a reserve to swap them with a field player.
   - Tabs 2+ highlight each incoming reserve and the field player they replace in a matching colour — handy for seeing the substitution pairs at a glance.
6. Tap **Save changes**. The match shows up under **Upcoming** on the dashboard. Phase 2 will add the live runner behind the **Enter game** button.

## Project layout

```
Co-Coach/
├── client/                 # React + Vite app
│   └── src/
│       ├── auth/           # AuthContext (login, register, JWT in localStorage)
│       ├── components/     # PitchView, ReservesBench, PlayerPickerSheet, AppShell
│       ├── domain/         # formations.ts (mirrored from server)
│       ├── lib/            # api.ts (fetch wrapper), autofill.ts (playtime logic)
│       ├── pages/          # one file per route
│       └── types.ts        # shared shapes
└── server/                 # Express + Drizzle API
    └── src/
        ├── db/             # schema.ts, client.ts, migrate.ts
        ├── domain/         # formations.ts (source of truth for formation slots)
        ├── middleware/     # error.ts, auth.ts, team.ts
        ├── routes/         # auth.ts, teams.ts, players.ts, matches.ts
        ├── env.ts
        └── index.ts
```

## Roadmap

**Phase 1 (done)**

- Multi-coach auth, single-team membership
- Roster CRUD with editable per-player season playtime
- Match creation (date, opponent, half length, sub windows, available players, goalie)
- Tabbed formation editor with playtime-weighted autofill and substitution-pair colour highlighting
- Upcoming / Previous matches list

**Phase 2 (next)**

- Live match runner: per-half timer with pause/resume, manual half end (negative clock allowed)
- Score tracking with goal-scorer attribution
- In-game manual substitutions with reason (exhaustion / injury / other)
- Timestamped notes saved with the game
- 5-minute half-time timer
- On save: accumulate playtime into each player; cascade re-balance into future scheduled matches
- Optional drag-and-drop in the formation editor (current UI is tap-to-edit, which works well on phones)
