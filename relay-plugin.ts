import type { Plugin, ViteDevServer } from "vite";
import { WebSocketServer, type WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

type Seat = {
  ws: WebSocket;
  id: string;
  name: string;
  characterId: string;
};

type Room = {
  code: string;
  hostId: string;
  seats: Map<string, Seat>;
};

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function makeCode(rooms: Map<string, Room>): string {
  for (let i = 0; i < 40; i++) {
    let code = "";
    for (let j = 0; j < 4; j++) {
      code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    }
    if (!rooms.has(code)) return code;
  }
  return `X${Date.now().toString(36).slice(-3).toUpperCase()}`;
}

function attach(server: ViteDevServer["httpServer"]) {
  if (!server) return;
  const flagged = server as typeof server & { __dgRelay?: boolean };
  if (flagged.__dgRelay) return;
  flagged.__dgRelay = true;

  const wss = new WebSocketServer({ noServer: true });
  const rooms = new Map<string, Room>();

  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = req.url ?? "";
    if (!url.startsWith("/ws-rooms")) return;
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  function send(ws: WebSocket, payload: unknown) {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload));
  }

  function roster(room: Room) {
    return [...room.seats.values()].map((s) => ({
      id: s.id,
      name: s.name,
      characterId: s.characterId,
      host: s.id === room.hostId,
    }));
  }

  function broadcast(room: Room, payload: unknown, except?: string) {
    const data = JSON.stringify(payload);
    for (const seat of room.seats.values()) {
      if (except && seat.id === except) continue;
      if (seat.ws.readyState === seat.ws.OPEN) seat.ws.send(data);
    }
  }

  wss.on("connection", (ws: WebSocket) => {
    let roomCode: string | null = null;
    let playerId: string | null = null;

    ws.on("message", (raw) => {
      let msg: { type?: string; [k: string]: unknown };
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }

      if (msg.type === "create") {
        const id = String(msg.id ?? "");
        const name = String(msg.name ?? "Host").slice(0, 16);
        const characterId = String(msg.characterId ?? "miles");
        if (!id) return;
        const code = makeCode(rooms);
        const room: Room = {
          code,
          hostId: id,
          seats: new Map(),
        };
        room.seats.set(id, { ws, id, name, characterId });
        rooms.set(code, room);
        roomCode = code;
        playerId = id;
        send(ws, { type: "joined", code, you: id, hostId: id, players: roster(room) });
        return;
      }

      if (msg.type === "join") {
        const code = String(msg.code ?? "")
          .trim()
          .toUpperCase();
        const id = String(msg.id ?? "");
        const name = String(msg.name ?? "Spidey").slice(0, 16);
        const characterId = String(msg.characterId ?? "miles");
        const room = rooms.get(code);
        if (!room || !id) {
          send(ws, { type: "error", message: "Room not found." });
          return;
        }
        if (room.seats.size >= 10) {
          send(ws, { type: "error", message: "Room is full (10)." });
          return;
        }
        if (room.seats.has(id)) {
          room.seats.get(id)!.ws = ws;
        } else {
          room.seats.set(id, { ws, id, name, characterId });
        }
        roomCode = code;
        playerId = id;
        send(ws, {
          type: "joined",
          code,
          you: id,
          hostId: room.hostId,
          players: roster(room),
        });
        broadcast(room, { type: "roster", players: roster(room) });
        return;
      }

      if (msg.type === "update") {
        if (!roomCode || !playerId) return;
        const room = rooms.get(roomCode);
        const seat = room?.seats.get(playerId);
        if (!seat) return;
        if (typeof msg.name === "string") seat.name = msg.name.slice(0, 16);
        if (typeof msg.characterId === "string") seat.characterId = msg.characterId;
        broadcast(room!, { type: "roster", players: roster(room!) });
        return;
      }

      if (msg.type === "relay") {
        if (!roomCode || !playerId) return;
        const room = rooms.get(roomCode);
        if (!room) return;
        broadcast(room, { type: "relay", from: playerId, payload: msg.payload }, playerId);
      }
    });

    ws.on("close", () => {
      if (!roomCode || !playerId) return;
      const room = rooms.get(roomCode);
      if (!room) return;
      room.seats.delete(playerId);
      if (room.seats.size === 0) {
        rooms.delete(roomCode);
        return;
      }
      if (room.hostId === playerId) {
        room.hostId = [...room.seats.keys()][0];
      }
      broadcast(room, { type: "roster", hostId: room.hostId, players: roster(room) });
    });
  });
}

export function roomRelay(): Plugin {
  return {
    name: "dimension-graffiti-relay",
    configureServer(server) {
      return () => attach(server.httpServer);
    },
    configurePreviewServer(server) {
      return () => attach(server.httpServer);
    },
  };
}
