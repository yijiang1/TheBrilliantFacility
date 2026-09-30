# Two-player online co-op

## Play

Use Node.js 22 or newer:

```sh
npm ci
npm start
```

Open `http://localhost:3000`, choose **Create a private room**, and copy the
invite link. Your teammate opens the link, both players click **Ready**, and
the host clicks **Start session**. The host selects proposals to begin the cycle.

A localhost link only works on the server computer. For friends on different
networks, deploy the server below and create the room from its **public HTTPS
address**. The generated invite will then use that public address. Both players
need a desktop browser and keyboard; no shared keyboard or port forwarding is
needed when using the hosted server.

- WASD or arrows: move your own scientist.
- Space: collect, deposit, start setup/measurement, or collect a result.
- E: pass the first available sample to a teammate within 64 world units.
  A sample being used for experiment setup cannot be passed.
- Escape: pause/resume the shared game. Either player can pause.
- The host controls proposals, purchases, and between-cycle decisions.
- Prep stations and control rooms run when either scientist (or a qualifying
  postdoc) is present. Two people do not double the processing rate.
- Gold hat is Player 1; teal hat is Player 2. Inventory letters: W/D = raw
  wet/dry sample, P = prepared, check mark = experiment ready.

## Deploy for an internet invite

The game needs a long-running Node web service with WebSocket support, not a
static-site-only host. HTML/assets and `/coop` run on the same port and origin.

### Render

The repository includes `render.yaml`. Connect this repository to a Render
Blueprint, inspect the proposed service, and deploy it. Alternatively create a
Node web service with:

| Setting | Value |
| --- | --- |
| Build command | `npm ci --omit=dev --ignore-scripts` |
| Start command | `npm start` |
| Node version | `24` |
| Health check | `/health` |
| Instances | **1** |

After deployment, open the provided HTTPS URL and create a room there. The
client automatically uses secure WebSockets (`wss`). No API keys or database
are required. The included Blueprint selects the free plan; review provider
availability and limits during setup. Automatic deploys are disabled so a push
does not unexpectedly interrupt a session.

References: [Render WebSockets](https://render.com/docs/websocket) and
[Blueprint fields](https://render.com/docs/blueprint-spec).

### Docker / another Node host

```sh
docker build -t brilliant-facility .
docker run --rm -p 3000:3000 brilliant-facility
```

Terminate HTTPS at the platform or reverse proxy and forward WebSocket upgrades
for `/coop`. Preserve the public `Host` header; the server checks browser origins.
`PORT` defaults to 3000 and can be supplied by the platform. Run a single instance:
rooms are held in memory and are not shared across server replicas. Docker
configuration is provided; validate it in your target deployment environment.

## First-version boundaries

- **Host-authoritative simulation:** Player 1's browser runs the existing Phaser
  game rules. Node relays role-checked messages; it does not run the simulation.
  This is designed for private games with friends, not competitive anti-cheat.
- The host must keep the game open. Hiding either game tab pauses the session.
  A normal connection loss pauses play and retries for up to 30 seconds.
- A guest can reload/reconnect in the same tab and retain inventory. Reconnection
  credentials live in that tab's session storage, never in the invite URL.
- Reloading/closing the host page loses the simulation. There is no host migration.
  Once the reconnect window expires, start a new room.
- Join before the session starts. No mid-cycle replacement players, matchmaking,
  accounts, chat, gamepad/mobile controls, or co-op campaign save/resume yet.
- Co-op does not overwrite solo saves or send the existing solo telemetry.
- Server restarts/redeployments clear rooms. Shared pause is handled separately
  from station processing; timers do not advance while a peer is disconnected.
- Guest movement is locally anticipated and corrected toward host snapshots.
  High latency can cause visible corrections. No rollback or input replay yet.
- Current single-player workload is retained for initial co-op playtesting.

## Architecture

`server/index.js` serves only an explicit public asset allowlist, manages private
rooms, reserves two player slots, relays snapshots from the host and input from
the guest, bounds message size/rate, and expires disconnected sessions.

`js/online.js` manages lobby UI, share links, readiness, reconnects, scene snapshots,
read-only guest menus, guest input, and the second scientist. Scenes serialize
explicit gameplay fields rather than Phaser display objects. Between-cycle menus
mirror the host's visible text and selection styles.

`js/game.js` retains the solo game and exposes separate movement, setup, and
rendering methods. A synchronous player-context adapter reuses interaction rules
for Player 2. World timers tick once, player inventories stay separate, and setup
reserves the specific sample and beamline. Samples keep stable IDs through prep,
setup, measurement, and handoffs. Both inventories participate in NPC departure
cleanup and job counts. Both clients use a 1280 × 800 world scaled to their screen.

For a larger release, move the world rules into a headless shared module and run
that module on the server; replace the context adapter and menu mirroring with
explicit player entities and semantic screen state.

## Verification

```sh
npm test
npx playwright install chromium
npm run test:browser
```

The server tests cover room admission/readiness, role validation, duplicate input,
reconnect credentials, room expiry, and private-file protection. The browser suite
uses independent browser contexts and different viewport sizes, actual invite
links and keyboard input. It covers sample transfer and the full processing
pipeline, simultaneous pickup contention, per-beamline setup ownership, NPC
cleanup, results synchronization, pause/resume, reconnect, and solo startup.
Deterministic gameplay fixtures place players near stations to exercise each
interaction without long travel times.
