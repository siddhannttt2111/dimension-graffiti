import type { RosterPlayer } from "../types";

export type RelayMsg =
  | { kind: "start"; seed: number; mode: string; difficulty: string; totalSlots: number; fillBots: boolean }
  | { kind: "input"; input: import("../types").InputState }
  | { kind: "state"; snap: unknown };

export class RoomClient {
  ws: WebSocket | null = null;
  id = `p-${Math.random().toString(36).slice(2, 9)}`;
  code = "";
  hostId = "";
  players: RosterPlayer[] = [];
  onRoster: ((players: RosterPlayer[], hostId: string) => void) | null = null;
  onJoined: ((code: string, hostId: string) => void) | null = null;
  onRelay: ((from: string, payload: RelayMsg) => void) | null = null;
  onError: ((message: string) => void) | null = null;

  get isHost() {
    return this.hostId === this.id;
  }

  connect(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return Promise.resolve();
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${proto}//${location.host}/ws-rooms`;
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      this.ws = ws;
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error("Could not reach the room server."));
      ws.onmessage = (ev) => {
        let msg: { type: string; [k: string]: unknown };
        try {
          msg = JSON.parse(String(ev.data));
        } catch {
          return;
        }
        if (msg.type === "joined") {
          this.code = String(msg.code);
          this.hostId = String(msg.hostId);
          this.players = msg.players as RosterPlayer[];
          this.onJoined?.(this.code, this.hostId);
          this.onRoster?.(this.players, this.hostId);
        } else if (msg.type === "roster") {
          if (typeof msg.hostId === "string") this.hostId = msg.hostId;
          this.players = msg.players as RosterPlayer[];
          this.onRoster?.(this.players, this.hostId);
        } else if (msg.type === "relay") {
          this.onRelay?.(String(msg.from), msg.payload as RelayMsg);
        } else if (msg.type === "error") {
          this.onError?.(String(msg.message ?? "Room error"));
        }
      };
    });
  }

  create(name: string, characterId: string) {
    this.send({ type: "create", id: this.id, name, characterId });
  }

  join(code: string, name: string, characterId: string) {
    this.send({ type: "join", code: code.trim().toUpperCase(), id: this.id, name, characterId });
  }

  update(name: string, characterId: string) {
    this.send({ type: "update", name, characterId });
  }

  relay(payload: RelayMsg) {
    this.send({ type: "relay", payload });
  }

  close() {
    this.ws?.close();
    this.ws = null;
  }

  private send(data: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(data));
  }
}
