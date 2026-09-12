# 2D Avatar Tag — Real-Time Multiplayer Game

A browser-based multiplayer tag game built from scratch to learn real-time networking, WebSockets, and netcode techniques used in production multiplayer games.

## Overview

Players connect over WebSockets and move a colored avatar around a shared canvas. One player is "it" and must tag another player by getting close enough; the tag transfers, with a short cooldown to prevent instant re-tagging. A player wins by surviving 60 seconds without being tagged.

The project's real goal wasn't the game itself — it was implementing the core networking patterns that make real-time multiplayer games feel responsive despite network latency: **client-side prediction**, **server reconciliation**, and **entity interpolation**.

Playable on both desktop (keyboard) and mobile (on-screen analog joystick), and deployed live on Render.

**Live demo:** _add your Render URL here once deployed_

## Tech Stack

- **Server:** Node.js, the `ws` library for WebSockets
- **Client:** HTML5 Canvas + vanilla JavaScript (no frameworks)
- **Transport:** Raw WebSocket messages (JSON), no additional networking libraries
- **Input:** Keyboard (desktop) and a custom on-screen analog joystick built with Touch Events (mobile) — both feed a shared normalized movement vector
- **Deployment:** Render (Node web service)

## How to Run

```bash
npm install
node server.js
```

Open `http://localhost:3000` in multiple browser tabs (or on multiple devices on the same network) to play.

**Controls:**
- **Desktop:** Arrow keys or WASD to move
- **Mobile:** A centered on-screen analog joystick appears automatically on touch devices — drag it in any direction to move, with speed proportional to how far you drag
- After a round ends, click/tap the **Restart** button that appears on screen (desktop players can also press `R`)

## How to Play

- When you join, you're assigned a colored dot. The very first player to connect starts as **"it"** — shown with a pulsing yellow ring around their dot.
- If you are "it," get close enough to another player to **tag** them. The yellow ring instantly transfers to them, and you're no longer "it."
- After a tag, there's a **1-second cooldown** before anyone can be tagged again — this stops the ring from bouncing back and forth if two players are standing next to each other.
- If you are **not** "it," your goal is to survive without being tagged. Survive **60 seconds** untagged and you **win** — the game announces it and freezes for everyone.
- Becoming "it" resets your own survival clock back to zero, so the tagger is always the one furthest from winning at that moment.
- When a round ends, tap/click **Restart** to reset survival clocks and start a new round without needing to refresh the page.

## Architecture

### Client-Authoritative Input, Server-Authoritative State

The client never tells the server "I am at position X, Y." Instead, it sends **inputs** (which keys are pressed) tagged with a sequence number. The server simulates movement itself based on those inputs and is the single source of truth for every player's actual position. This closes the obvious cheating vector of a client just claiming any position it wants.

### Unified Analog Input (Keyboard + Touch)

Rather than treating keyboard and touch as separate input systems, both are normalized into a single `(moveX, moveY)` vector in the range -1 to 1 before being sent to the server. Keyboard presses are converted to a unit vector (with diagonal movement normalized so it isn't faster than straight movement), while the on-screen joystick produces a naturally analog vector based on drag distance from center. The server, prediction, and reconciliation logic only ever deal with this one vector shape — they have no awareness of which input device produced it.

### Client-Side Prediction

Waiting for a server round-trip before moving would make the game feel sluggish, so the client applies its own inputs locally and immediately, rendering movement before the server has confirmed it. This is what makes controls feel instant regardless of network latency.

### Server Reconciliation

Because the client predicts ahead of the server, the two can drift apart — especially under latency or packet loss. Each server broadcast includes the last input sequence number it has processed for that player. The client:

1. Snaps its local position to the server's authoritative value
2. Discards any of its own inputs already confirmed by that sequence number
3. Re-applies any inputs sent but not yet confirmed, on top of the corrected position

This keeps local movement smooth and responsive while guaranteeing it never permanently diverges from what the server considers true.

### Entity Interpolation (for other players)

The server only broadcasts state at 20Hz, while the game renders at 60Hz. Rendering other players' positions directly at 20Hz would look like visible teleporting. Instead, the client buffers a short history of each remote player's positions and renders them **100ms in the past**, interpolating smoothly between the two surrounding snapshots. This trades a small, constant amount of latency for consistently smooth motion.

### Fixed-Timestep Game Loop

Both client and server use an accumulator-based fixed timestep rather than raw frame deltas, so simulation speed stays consistent regardless of variable frame rate or hardware — the same technique used in most real-time game engines.

### Server-Authoritative Tag Logic

Proximity checks for tagging happen exclusively on the server using its own trusted position data, with a global cooldown after each tag to prevent tag-transfer race conditions when two players are adjacent for multiple ticks in a row.

## Project Structure

```
avatar-tag/
├── server.js        # HTTP server, WebSocket handling, game state, tick loop
├── public/
│   ├── index.html   # Canvas + page shell
│   └── game.js       # Client game loop, rendering, prediction/reconciliation/interpolation
└── package.json
```

## What I Learned

- Why real-time multiplayer games can't simply trust or wait on the network — the prediction/reconciliation pattern exists specifically to reconcile "instant-feeling controls" with "server as source of truth"
- How interpolation trades a small fixed delay for visual smoothness, and why that trade-off is almost always worth it
- The importance of keeping game-critical logic (tagging, collision, win conditions) server-side to prevent client-side cheating
- Debugging real desync and race-condition bugs (tag ping-ponging, stale server processes, spawn overlap) that only surface once multiple real clients are involved — not the kind of bug you hit building single-player software
- Designing an input abstraction that treats keyboard and touch as interchangeable sources of the same normalized vector, instead of writing separate movement logic per input type
- Handling the practical differences between `http/ws` (local dev) and `https/wss` (production) so the same client code works in both environments

## Possible Extensions

- Dead reckoning / extrapolation to handle interpolation buffer underrun on high-latency connections
- Lobby screen and player name entry before a round starts
- Support for more than one simultaneous tagger, or team-based tag variants