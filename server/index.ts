import http from "node:http";
import path from "node:path";
import { WebSocketServer } from "ws";
import { DEFAULT_ROOM_CODE, DEFAULT_SERVER_PORT, MAX_PLAYERS_PER_ROOM } from "../src/shared/constants";
import { RoomServer } from "./room";

const port = Number(process.env.PORT ?? DEFAULT_SERVER_PORT);
const roomCode = process.env.ROOM_CODE ?? DEFAULT_ROOM_CODE;
const maxPlayers = Number(process.env.MAX_PLAYERS ?? MAX_PLAYERS_PER_ROOM);
const dataDir = process.env.WORLD_DATA_DIR ?? path.join(process.cwd(), "server-data");
const seed = Number(process.env.WORLD_SEED ?? Math.floor(Math.random() * 2_147_483_647));

const room = new RoomServer(seed, dataDir, roomCode, maxPlayers);
room.start();

const httpServer = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, roomCode, maxPlayers }));
    return;
  }
  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "not_found" }));
});

const wsServer = new WebSocketServer({ server: httpServer });
wsServer.on("connection", (ws) => {
  room.handleConnection(ws);
});

httpServer.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Multiplayer server listening on ws://localhost:${port} room=${roomCode}`);
});

function shutdown(): void {
  room.stop();
  wsServer.close();
  httpServer.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
