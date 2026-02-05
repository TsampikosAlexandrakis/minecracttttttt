# Three.js Minecraft Clone

Minecraft-style voxel game prototype built with Three.js + TypeScript + Vite with single-player and server-authoritative multiplayer.

## Features

- Procedural chunked world generation with chunk streaming
- Instanced voxel rendering for visible terrain blocks
- First-person controls with collision, gravity, sprint, and jump
- Block breaking and placing
- Hotbar inventory and basic crafting recipes
- One hostile mob type with chase + melee behavior
- Single-player IndexedDB save/load for chunks and player state
- Dedicated WebSocket multiplayer server (`ws`) with authoritative world simulation
- Multiplayer sync for players, block edits, mobs, health, hotbar/inventory, and crafting

## Run

1. Install dependencies:

```bash
npm install
```

2. Start client only (single-player + multiplayer launcher UI):

```bash
npm run dev:client
```

3. Start multiplayer server (optional for multiplayer mode):

```bash
npm run dev:server
```

4. Or run both:

```bash
npm run dev:all
```

5. Open the local Vite URL in your browser.

## Controls

- Click game canvas: lock mouse
- `WASD`: move
- `Shift`: sprint
- `Space`: jump
- Mouse move: look
- Left mouse: mine block (hold) / attack mob
- Right mouse: place selected block
- Mouse wheel or `1-9`: select hotbar slot
- `C`: toggle crafting panel
- Crafting panel open: press `1-3` to craft listed recipes

## Multiplayer

- In the launcher, choose **Multiplayer**
- Server URL default: `ws://localhost:8080`
- Room code default: `alpha`
- Nickname is required

Server environment variables:

- `PORT` (default `8080`)
- `ROOM_CODE` (default `alpha`)
- `MAX_PLAYERS` (default `8`)
- `WORLD_SEED` (default random)
- `WORLD_DATA_DIR` (default `./server-data`)
