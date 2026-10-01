import { CAST, heroById } from "../cast";
import type { Difficulty, GameMode, InputState, MatchConfig, Phase, PlayerSetup } from "../types";
import { EMPTY_INPUT } from "../types";

const WORLD_W = 8600;
const WORLD_H = 920;
const GRAVITY = 2550;
const MOVE = 760;
const AIR = 0.62;
const JUMP = -980;
const MAX_WEB = 520;
const PLAYER_W = 34;
const PLAYER_H = 46;

export type Building = {
  x: number;
  y: number;
  w: number;
  h: number;
  owner: string | null;
  paint: number;
  water: boolean;
  billboard: boolean;
};

export type Checkpoint = { x: number; y: number; r: number };

type Web = { ax: number; ay: number; rest: number };

type Actor = {
  id: string;
  name: string;
  characterId: string;
  bot: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: 1 | -1;
  grounded: boolean;
  web: Web | null;
  spray: number;
  checkpoints: number;
  finished: number;
  jumpBuf: number;
  coyote: number;
  color: string;
  accent: string;
  eye: string;
};

export type ScoreRow = {
  id: string;
  name: string;
  characterId: string;
  color: string;
  tagScore: number;
  raceScore: number;
  checkpoints: number;
  finished: number;
  place: number;
};

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

function aabb(
  ax: number,
  ay: number,
  aw: number,
  ah: number,
  bx: number,
  by: number,
  bw: number,
  bh: number,
) {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

export class Match {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  config: MatchConfig;
  localId: string;
  host: boolean;
  actors: Actor[] = [];
  buildings: Building[] = [];
  checkpoints: Checkpoint[] = [];
  finish: { x: number; y: number; w: number; h: number } = { x: 0, y: 0, w: 70, h: 160 };
  inputs = new Map<string, InputState>();
  phase: Phase = "countdown";
  mode: GameMode;
  time = 3;
  tagTime = 120;
  raceTime = 90;
  cameraX = 0;
  cameraY = 0;
  shake = 0;
  t = 0;
  running = false;
  last = 0;
  raf = 0;
  onHud?: () => void;
  onOver?: (rows: ScoreRow[]) => void;
  private botThink = new Map<string, { tx: number; spray: boolean; web: boolean; jump: boolean }>();
  private difficulty: Difficulty;
  private ended = false;
  private afterCount: "tag" | "race" = "tag";

  constructor(canvas: HTMLCanvasElement, config: MatchConfig, host: boolean) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("No canvas");
    this.ctx = ctx;
    this.config = config;
    this.localId = config.localId;
    this.host = host;
    this.mode = config.mode;
    this.difficulty = config.difficulty;
    this.afterCount = config.mode === "race" ? "race" : "tag";
    this.buildWorld(config.seed);
    this.spawn(config.players);
    this.phase = "countdown";
    this.time = 3;
  }

  start() {
    this.running = true;
    this.last = performance.now();
    const loop = (now: number) => {
      if (!this.running) return;
      const dt = Math.min(0.033, (now - this.last) / 1000);
      this.last = now;
      if (this.host) this.step(dt);
      this.draw();
      this.onHud?.();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  destroy() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  setLocalInput(input: InputState) {
    this.inputs.set(this.localId, input);
  }

  setRemoteInput(id: string, input: InputState) {
    this.inputs.set(id, input);
  }

  snapshot() {
    return {
      phase: this.phase,
      time: this.time,
      tagTime: this.tagTime,
      raceTime: this.raceTime,
      t: this.t,
      buildings: this.buildings.map((b) => ({ owner: b.owner, paint: b.paint })),
      actors: this.actors.map((a) => ({
        id: a.id,
        x: a.x,
        y: a.y,
        vx: a.vx,
        vy: a.vy,
        facing: a.facing,
        grounded: a.grounded,
        web: a.web,
        spray: a.spray,
        checkpoints: a.checkpoints,
        finished: a.finished,
      })),
    };
  }

  applySnapshot(s: ReturnType<Match["snapshot"]>) {
    this.phase = s.phase;
    this.time = s.time;
    this.tagTime = s.tagTime;
    this.raceTime = s.raceTime;
    this.t = s.t;
    s.buildings.forEach((b, i) => {
      if (this.buildings[i]) {
        this.buildings[i].owner = b.owner;
        this.buildings[i].paint = b.paint;
      }
    });
    for (const row of s.actors) {
      const a = this.actors.find((p) => p.id === row.id);
      if (!a) continue;
      a.x = row.x;
      a.y = row.y;
      a.vx = row.vx;
      a.vy = row.vy;
      a.facing = row.facing;
      a.grounded = row.grounded;
      a.web = row.web;
      a.spray = row.spray;
      a.checkpoints = row.checkpoints;
      a.finished = row.finished;
    }
  }

  scores(): ScoreRow[] {
    const tag = new Map<string, number>();
    for (const b of this.buildings) {
      if (!b.owner) continue;
      tag.set(b.owner, (tag.get(b.owner) ?? 0) + b.w * b.h * b.paint);
    }
    const rows: ScoreRow[] = this.actors.map((a) => {
      const tagScore = Math.round((tag.get(a.id) ?? 0) / 80);
      const raceScore =
        a.finished > 0
          ? 2000 - Math.round(a.finished * 8)
          : a.checkpoints * 120;
      return {
        id: a.id,
        name: a.name,
        characterId: a.characterId,
        color: a.color,
        tagScore,
        raceScore: Math.max(0, raceScore),
        checkpoints: a.checkpoints,
        finished: a.finished,
        place: 0,
      };
    });
    const key = this.phase === "race" || this.phase === "done" ? "raceScore" : "tagScore";
    if (this.config.mode === "both" && this.phase === "done") {
      rows.sort((a, b) => b.tagScore + b.raceScore - (a.tagScore + a.raceScore));
    } else {
      rows.sort((a, b) => b[key] - a[key]);
    }
    rows.forEach((r, i) => {
      r.place = i + 1;
    });
    return rows;
  }

  hud() {
    const local = this.actors.find((a) => a.id === this.localId);
    return {
      phase: this.phase,
      time: this.time,
      tagTime: this.tagTime,
      raceTime: this.raceTime,
      checkpoints: local?.checkpoints ?? 0,
      totalCk: this.checkpoints.length,
      scores: this.scores(),
    };
  }

  private buildWorld(seed: number) {
    const rand = mulberry32(seed);
    const street = WORLD_H - 58;
    const buildings: Building[] = [];
    let x = 90;
    let i = 0;
    while (x < WORLD_W - 380) {
      const w = 170 + rand() * 250;
      const h = 150 + rand() * 310;
      const gap = 55 + rand() * 150;
      buildings.push({
        x,
        y: street - h,
        w,
        h,
        owner: null,
        paint: 0,
        water: rand() > 0.72,
        billboard: rand() > 0.8,
      });
      x += w + gap;
      i += 1;
      if (i === 8) {
        buildings.push({
          x: x + 40,
          y: street - 420,
          w: 160,
          h: 36,
          owner: null,
          paint: 0,
          water: false,
          billboard: true,
        });
      }
    }
    this.buildings = buildings;
    const ck: Checkpoint[] = [];
    const pick = [1, 3, 5, 7, 10, 13, 16, buildings.length - 3];
    for (const idx of pick) {
      const b = buildings[clamp(idx, 0, buildings.length - 1)];
      ck.push({ x: b.x + b.w / 2, y: b.y - 36, r: 34 });
    }
    this.checkpoints = ck;
    const last = buildings[buildings.length - 1];
    this.finish = { x: last.x + last.w / 2 - 36, y: last.y - 150, w: 72, h: 150 };
  }

  private spawn(humans: PlayerSetup[]) {
    const used = new Set(humans.map((p) => p.characterId));
    const list: PlayerSetup[] = [...humans];
    if (this.config.fillBots) {
      let i = 0;
      while (list.length < this.config.totalSlots && list.length < 10) {
        const hero = CAST.find((c) => !used.has(c.id)) ?? CAST[i % CAST.length];
        used.add(hero.id);
        list.push({
          id: `bot-${hero.id}-${i}`,
          name: hero.name,
          characterId: hero.id,
          bot: true,
        });
        i += 1;
      }
    }
    const startX = 140;
    this.actors = list.map((p, idx) => {
      const h = heroById(p.characterId);
      return {
        id: p.id,
        name: p.name,
        characterId: p.characterId,
        bot: !!p.bot,
        x: startX + idx * 46,
        y: 200,
        vx: 0,
        vy: 0,
        facing: 1 as const,
        grounded: false,
        web: null,
        spray: 0,
        checkpoints: 0,
        finished: 0,
        jumpBuf: 0,
        coyote: 0,
        color: h.color,
        accent: h.accent,
        eye: h.eye,
      };
    });
    for (const a of this.actors) this.inputs.set(a.id, { ...EMPTY_INPUT });
  }

  private resetForRace() {
    this.actors.forEach((a, idx) => {
      a.x = 140 + idx * 46;
      a.y = 180;
      a.vx = 0;
      a.vy = 0;
      a.web = null;
      a.spray = 0;
      a.checkpoints = 0;
      a.finished = 0;
      a.grounded = false;
    });
    this.afterCount = "race";
    this.phase = "countdown";
    this.time = 3;
    this.raceTime = 90;
  }

  private step(dt: number) {
    this.t += dt;
    this.shake *= 0.9;
    if (this.phase === "countdown") {
      this.time -= dt;
      if (this.time <= 0) {
        this.phase = this.afterCount;
        this.time = 0;
      }
      this.moveCamera(dt);
      return;
    }

    if (this.phase === "tag") {
      this.tagTime -= dt;
      if (this.tagTime <= 0) {
        this.tagTime = 0;
        if (this.mode === "both") {
          this.phase = "tag_results";
          this.time = 4;
        } else {
          this.finishMatch();
          return;
        }
      }
    } else if (this.phase === "tag_results") {
      this.time -= dt;
      if (this.time <= 0) this.resetForRace();
      this.moveCamera(dt);
      return;
    } else if (this.phase === "race") {
      this.raceTime -= dt;
      const live = this.actors.filter((a) => a.finished === 0);
      if (this.raceTime <= 0 || live.length === 0) {
        this.finishMatch();
        return;
      }
    } else if (this.phase === "done") {
      this.moveCamera(dt);
      return;
    }

    for (const a of this.actors) {
      if (a.bot) this.driveBot(a, dt);
      this.simActor(a, dt);
    }
    this.moveCamera(dt);
  }

  private finishMatch() {
    if (this.ended) return;
    this.ended = true;
    this.phase = "done";
    this.onOver?.(this.scores());
  }

  private driveBot(a: Actor, dt: number) {
    let think = this.botThink.get(a.id);
    const interval = this.difficulty === "verse" ? 0.18 : this.difficulty === "street" ? 0.32 : 0.5;
    if (!think || Math.random() < dt / interval) {
      think = this.pickBotGoal(a);
      this.botThink.set(a.id, think);
    }
    const inp: InputState = {
      left: a.x > think.tx + 12,
      right: a.x < think.tx - 12,
      jump: think.jump || a.vy > 220,
      spray: think.spray,
      web: think.web || a.y > 640,
      aimX: think.tx,
      aimY: a.y - 180,
    };
    const speed = this.difficulty === "chill" ? 0.72 : this.difficulty === "verse" ? 1 : 0.88;
    if (!inp.left && !inp.right) {
      /* idle */
    } else if (Math.random() > speed) {
      inp.left = false;
      inp.right = false;
    }
    this.inputs.set(a.id, inp);
  }

  private pickBotGoal(a: Actor) {
    if (this.phase === "race") {
      const next = this.checkpoints[a.checkpoints] ?? {
        x: this.finish.x,
        y: this.finish.y,
      };
      const ahead = this.buildings.find((b) => b.x + b.w > a.x + 40) ?? this.buildings.at(-1)!;
      return {
        tx: next.x,
        spray: false,
        web: ahead.y < a.y - 40,
        jump: next.x - a.x > 40 && Math.abs(next.y - a.y) > 30,
      };
    }
    let best: Building | null = null;
    let bestScore = -1e9;
    for (const b of this.buildings) {
      if (b.h < 50) continue;
      const owned = b.owner === a.id && b.paint > 0.85;
      if (owned) continue;
      const dist = Math.abs(b.x + b.w / 2 - a.x) + Math.abs(b.y - a.y) * 0.4;
      const steal = b.owner && b.owner !== a.id ? 220 : 0;
      const score = -dist + (1 - b.paint) * 180 + steal;
      if (score > bestScore) {
        bestScore = score;
        best = b;
      }
    }
    const b = best ?? this.buildings[0];
    const on = a.grounded && a.x + PLAYER_W > b.x && a.x < b.x + b.w && a.y + PLAYER_H <= b.y + 8;
    return {
      tx: b.x + b.w * 0.45,
      spray: on || Math.abs(a.x - (b.x + b.w / 2)) < b.w / 2,
      web: b.y < a.y - 80,
      jump: b.y < a.y - 20,
    };
  }

  private simActor(a: Actor, dt: number) {
    const inp = this.inputs.get(a.id) ?? EMPTY_INPUT;
    if (inp.jump) a.jumpBuf = 0.12;
    else a.jumpBuf -= dt;
    if (a.grounded) a.coyote = 0.14;
    else a.coyote -= dt;

    const wish = (inp.left ? -1 : 0) + (inp.right ? 1 : 0);
    if (wish) a.facing = wish > 0 ? 1 : -1;
    a.vx += wish * (a.grounded ? 9200 : 4200 * AIR) * dt;
    a.vx *= Math.pow(a.grounded ? 0.045 : 0.22, dt);
    a.vx = clamp(a.vx, -MOVE, MOVE);

    a.vy += GRAVITY * dt;

    if (inp.web) this.tryWeb(a, inp);
    else a.web = null;

    if (a.web) {
      const dx = a.x + PLAYER_W / 2 - a.web.ax;
      const dy = a.y - a.web.ay;
      const dist = Math.hypot(dx, dy) || 1;
      if (dist > a.web.rest) {
        const nx = dx / dist;
        const ny = dy / dist;
        const pull = (dist - a.web.rest) * 18;
        a.vx -= nx * pull * dt;
        a.vy -= ny * pull * dt;
      }
      a.vy += -40 * dt;
    }

    if (a.jumpBuf > 0 && (a.coyote > 0 || a.web)) {
      a.vy = JUMP * 1.06;
      a.jumpBuf = 0;
      a.coyote = 0;
      a.web = null;
      a.grounded = false;
      this.shake = Math.max(this.shake, 4);
    }

    a.x += a.vx * dt;
    this.collideX(a);
    a.y += a.vy * dt;
    a.grounded = false;
    this.collideY(a);

    a.x = clamp(a.x, 20, WORLD_W - 60);
    if (a.y > WORLD_H - PLAYER_H - 8) {
      a.y = WORLD_H - PLAYER_H - 8;
      a.vy = 0;
      a.grounded = true;
    }

    if (this.phase === "tag" && inp.spray) this.spray(a, dt);
    else a.spray = Math.max(0, a.spray - dt * 1.4);

    if (this.phase === "race") this.raceProgress(a);
  }

  private tryWeb(a: Actor, inp: InputState) {
    if (a.web) return;
    const originX = a.x + PLAYER_W / 2;
    const originY = a.y;
    let aimX = inp.aimX;
    let aimY = inp.aimY;
    if (!aimX && !aimY) {
      aimX = originX + a.facing * 180;
      aimY = originY - 240;
    }
    let best: { x: number; y: number; d: number } | null = null;
    for (const b of this.buildings) {
      const pts = [
        { x: b.x + 12, y: b.y },
        { x: b.x + b.w - 12, y: b.y },
        { x: b.x + b.w / 2, y: b.y },
      ];
      for (const p of pts) {
        const d = Math.hypot(p.x - originX, p.y - originY);
        if (d > MAX_WEB || p.y > originY + 40) continue;
        const toAim = Math.hypot(p.x - aimX, p.y - aimY);
        const score = d + toAim * 0.45;
        if (!best || score < best.d) best = { x: p.x, y: p.y, d: score };
      }
    }
    if (!best) return;
    const rest = Math.hypot(best.x - originX, best.y - originY) * 0.86;
    a.web = { ax: best.x, ay: best.y, rest: clamp(rest, 90, MAX_WEB) };
  }

  private collideX(a: Actor) {
    for (const b of this.buildings) {
      if (!aabb(a.x, a.y, PLAYER_W, PLAYER_H, b.x, b.y, b.w, b.h)) continue;
      if (a.vx > 0) a.x = b.x - PLAYER_W - 0.1;
      else if (a.vx < 0) a.x = b.x + b.w + 0.1;
      a.vx = 0;
    }
  }

  private collideY(a: Actor) {
    for (const b of this.buildings) {
      if (!aabb(a.x, a.y, PLAYER_W, PLAYER_H, b.x, b.y, b.w, b.h)) continue;
      if (a.vy >= 0 && a.y + PLAYER_H - a.vy * 0.02 <= b.y + 16) {
        a.y = b.y - PLAYER_H;
        a.vy = 0;
        a.grounded = true;
      } else if (a.vy < 0) {
        a.y = b.y + b.h;
        a.vy = 80;
      }
    }
  }

  private spray(a: Actor, dt: number) {
    const footX = a.x + PLAYER_W / 2;
    const footY = a.y + PLAYER_H + 2;
    const b = this.buildings.find(
      (bl) => footX >= bl.x && footX <= bl.x + bl.w && footY >= bl.y - 6 && footY <= bl.y + 28,
    );
    if (!b || !a.grounded) return;
    const rate = 0.55 * dt * (this.difficulty === "chill" ? 1.15 : 1);
    if (b.owner && b.owner !== a.id) {
      b.paint = Math.max(0, b.paint - rate * 1.2);
      if (b.paint <= 0.05) {
        b.owner = a.id;
        b.paint = 0.12;
      }
    } else {
      b.owner = a.id;
      b.paint = Math.min(1, b.paint + rate);
    }
    a.spray = Math.min(1, a.spray + dt * 3);
  }

  private raceProgress(a: Actor) {
    if (a.finished) return;
    const next = this.checkpoints[a.checkpoints];
    const cx = a.x + PLAYER_W / 2;
    const cy = a.y + PLAYER_H / 2;
    if (next && Math.hypot(cx - next.x, cy - next.y) < next.r + 16) {
      a.checkpoints += 1;
    }
    if (
      a.checkpoints >= this.checkpoints.length &&
      aabb(a.x, a.y, PLAYER_W, PLAYER_H, this.finish.x, this.finish.y, this.finish.w, this.finish.h)
    ) {
      a.finished = 90 - this.raceTime;
    }
  }

  private moveCamera(dt: number) {
    const me = this.actors.find((a) => a.id === this.localId) ?? this.actors[0];
    const viewW = this.viewW();
    const viewH = this.viewH();
    const targetX = clamp(me.x - viewW * 0.42, 0, Math.max(0, WORLD_W - viewW));
    const targetY = clamp(me.y - viewH * 0.52, 0, Math.max(0, WORLD_H - viewH));
    const k = 1 - Math.pow(0.001, dt);
    this.cameraX += (targetX - this.cameraX) * k;
    this.cameraY += (targetY - this.cameraY) * k;
  }

  private viewW() {
    return (this.canvas.width / this.canvas.height) * 780;
  }

  private viewH() {
    return 780;
  }

  private draw() {
    const ctx = this.ctx;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cssW = this.canvas.clientWidth || window.innerWidth;
    const cssH = this.canvas.clientHeight || window.innerHeight;
    if (this.canvas.width !== Math.floor(cssW * dpr) || this.canvas.height !== Math.floor(cssH * dpr)) {
      this.canvas.width = Math.floor(cssW * dpr);
      this.canvas.height = Math.floor(cssH * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = cssW;
    const h = cssH;
    const viewW = this.viewW();
    const viewH = this.viewH();
    const sx = w / viewW;
    const sy = h / viewH;
    const shakeX = (Math.random() - 0.5) * this.shake;
    const shakeY = (Math.random() - 0.5) * this.shake;

    ctx.fillStyle = "#07060c";
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.scale(sx, sy);
    ctx.translate(-this.cameraX + shakeX, -this.cameraY + shakeY);

    this.drawSky(viewW, viewH);
    this.drawParallax();
    this.drawStreet();
    this.drawBuildings();
    if (this.phase === "race" || this.afterCount === "race") {
      this.drawRace();
    }
    for (const a of this.actors) this.drawWeb(a);
    const sorted = [...this.actors].sort((p, q) => p.y - q.y);
    for (const a of sorted) this.drawActor(a);

    ctx.restore();
    this.drawVignette(w, h);
    this.drawCountdown(w, h);
  }

  private drawSky(viewW: number, viewH: number) {
    const ctx = this.ctx;
    ctx.fillStyle = "#1b1038";
    ctx.fillRect(this.cameraX - 40, this.cameraY - 40, viewW + 80, viewH + 80);

    ctx.globalAlpha = 0.35;
    for (let i = 0; i < 80; i++) {
      const x = ((i * 137 + this.t * 8) % WORLD_W);
      const y = (i * 73) % 500;
      ctx.fillStyle = i % 3 === 0 ? "#7af6ff" : "#ff4ad6";
      ctx.fillRect(x, y, 2, 2);
    }
    ctx.globalAlpha = 1;

    ctx.fillStyle = "#f4f0c8";
    ctx.beginPath();
    ctx.arc(this.cameraX + viewW * 0.82, this.cameraY + 90, 46, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.15;
    ctx.beginPath();
    ctx.arc(this.cameraX + viewW * 0.82, this.cameraY + 90, 90, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  private drawParallax() {
    const ctx = this.ctx;
    const base = this.cameraX * 0.35;
    ctx.fillStyle = "#120c22";
    for (let i = 0; i < 28; i++) {
      const x = i * 220 - (base % 220);
      const h = 220 + ((i * 67) % 260);
      ctx.fillRect(x, WORLD_H - 80 - h, 140, h);
      ctx.fillStyle = i % 2 ? "#1a1030" : "#140c28";
    }
  }

  private drawStreet() {
    const ctx = this.ctx;
    ctx.fillStyle = "#141018";
    ctx.fillRect(0, WORLD_H - 58, WORLD_W, 58);
    ctx.fillStyle = "#f0d24a";
    for (let x = 0; x < WORLD_W; x += 70) ctx.fillRect(x, WORLD_H - 30, 36, 4);
    ctx.fillStyle = "#ff2bd6";
    ctx.globalAlpha = 0.25;
    ctx.fillRect(0, WORLD_H - 62, WORLD_W, 4);
    ctx.globalAlpha = 1;
  }

  private drawBuildings() {
    const ctx = this.ctx;
    for (const b of this.buildings) {
      ctx.fillStyle = "#1c1a28";
      ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.fillStyle = "#0e0c16";
      ctx.fillRect(b.x + 6, b.y + 8, b.w - 12, b.h - 8);

      if (b.owner) {
        const hero = this.actors.find((a) => a.id === b.owner);
        ctx.globalAlpha = 0.2 + b.paint * 0.55;
        ctx.fillStyle = hero?.color ?? "#fff";
        const ph = b.h * b.paint;
        ctx.fillRect(b.x + 4, b.y + b.h - ph, b.w - 8, ph);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = hero?.color ?? "#fff";
        ctx.lineWidth = 3;
        ctx.strokeRect(b.x + 2, b.y + 2, b.w - 4, b.h - 4);
      }

      ctx.fillStyle = "#f6e27a";
      const cols = Math.max(3, Math.floor(b.w / 28));
      const rows = Math.max(3, Math.floor(b.h / 36));
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if ((r + c + Math.floor(b.x)) % 3 === 0) continue;
          ctx.globalAlpha = 0.35 + ((r * c) % 5) * 0.08;
          ctx.fillRect(b.x + 12 + c * 24, b.y + 16 + r * 30, 10, 14);
        }
      }
      ctx.globalAlpha = 1;

      if (b.water) {
        ctx.fillStyle = "#cfd6de";
        ctx.fillRect(b.x + b.w * 0.35, b.y - 34, 40, 34);
        ctx.beginPath();
        ctx.arc(b.x + b.w * 0.35 + 20, b.y - 34, 20, Math.PI, 0);
        ctx.fill();
      }
      if (b.billboard) {
        ctx.fillStyle = "#2a1a44";
        ctx.fillRect(b.x + 16, b.y - 70, Math.min(140, b.w - 32), 54);
        ctx.fillStyle = "#ff2bd6";
        ctx.font = "700 16px 'Space Grotesk', sans-serif";
        ctx.fillText("SPOT THE", b.x + 24, b.y - 42);
        ctx.fillStyle = "#7af6ff";
        ctx.fillText("GLITCH", b.x + 24, b.y - 24);
      }
    }
  }

  private drawRace() {
    const ctx = this.ctx;
    this.checkpoints.forEach((c, i) => {
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.strokeStyle = "#7af6ff";
      ctx.lineWidth = 4;
      ctx.globalAlpha = 0.55 + Math.sin(this.t * 6 + i) * 0.2;
      ctx.beginPath();
      ctx.ellipse(0, 0, c.r, c.r * 0.45, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "#ffffff";
      ctx.globalAlpha = 0.9;
      ctx.font = "700 14px 'Space Grotesk', sans-serif";
      ctx.fillText(`${i + 1}`, -4, 4);
      ctx.restore();
    });
    const f = this.finish;
    ctx.fillStyle = "#ff2bd6";
    ctx.globalAlpha = 0.55;
    ctx.fillRect(f.x, f.y, f.w, f.h);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = "#fff";
    ctx.strokeRect(f.x, f.y, f.w, f.h);
    ctx.font = "700 16px 'Bangers', sans-serif";
    ctx.fillStyle = "#fff";
    ctx.fillText("PORTAL", f.x - 4, f.y - 8);
  }

  private drawWeb(a: Actor) {
    if (!a.web) return;
    const ctx = this.ctx;
    ctx.strokeStyle = "#f4f8ff";
    ctx.shadowColor = "#7af6ff";
    ctx.shadowBlur = 12;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(a.x + PLAYER_W / 2, a.y + 8);
    ctx.lineTo(a.web.ax, a.web.ay);
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  private drawActor(a: Actor) {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(a.x + PLAYER_W / 2, a.y + PLAYER_H);
    ctx.scale(a.facing, 1);

    ctx.fillStyle = "rgba(0,0,0,0.4)";
    ctx.beginPath();
    ctx.ellipse(0, 3, 14, 5, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = a.accent;
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(-6, -16);
    ctx.lineTo(-9, 0);
    ctx.moveTo(6, -16);
    ctx.lineTo(9, 0);
    ctx.stroke();

    ctx.fillStyle = a.accent;
    ctx.beginPath();
    ctx.roundRect(-11, -38, 22, 24, 6);
    ctx.fill();

    ctx.fillStyle = a.color;
    ctx.beginPath();
    ctx.moveTo(0, -16);
    ctx.lineTo(-9, -30);
    ctx.lineTo(9, -30);
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    ctx.arc(0, -42, 13, Math.PI, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(-13, -44, 26, 12);

    ctx.fillStyle = a.accent;
    ctx.beginPath();
    ctx.roundRect(-11, -46, 22, 16, 7);
    ctx.fill();

    ctx.fillStyle = a.eye;
    ctx.beginPath();
    ctx.ellipse(-5, -38, 4.6, 6.2, 0.12, 0, Math.PI * 2);
    ctx.ellipse(5, -38, 4.6, 6.2, -0.12, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = a.color;
    ctx.globalAlpha = 0.9;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(-11, -32);
    ctx.quadraticCurveTo(-24, -20, -17, -6);
    ctx.moveTo(11, -32);
    ctx.quadraticCurveTo(24, -20, 17, -6);
    ctx.stroke();
    ctx.globalAlpha = 1;

    if (a.spray > 0.1) {
      ctx.fillStyle = a.color;
      ctx.globalAlpha = 0.75;
      for (let i = 0; i < 7; i++) {
        ctx.fillRect(10 + i * 4, -18 + Math.sin(this.t * 22 + i) * 5, 4, 3);
      }
      ctx.globalAlpha = 1;
    }

    ctx.restore();

    ctx.font = "700 12px 'Space Grotesk', sans-serif";
    ctx.textAlign = "center";
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#000";
    ctx.strokeText(a.name, a.x + PLAYER_W / 2, a.y - 14);
    ctx.fillStyle = a.id === this.localId ? "#7af6ff" : "#ffffff";
    ctx.fillText(a.name, a.x + PLAYER_W / 2, a.y - 14);
    ctx.textAlign = "left";
  }

  private drawVignette(w: number, h: number) {
    const ctx = this.ctx;
    ctx.strokeStyle = "#7af6ff";
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 6;
    ctx.strokeRect(10, 10, w - 20, h - 20);
    ctx.strokeStyle = "#ff2bd6";
    ctx.globalAlpha = 0.25;
    ctx.strokeRect(16, 16, w - 32, h - 32);
    ctx.globalAlpha = 1;
  }

  private drawCountdown(w: number, h: number) {
    if (this.phase !== "countdown") return;
    const ctx = this.ctx;
    const n = Math.ceil(this.time);
    ctx.save();
    ctx.fillStyle = "rgba(8,0,20,0.35)";
    ctx.fillRect(0, 0, w, h);
    ctx.font = "400 140px 'Bangers', cursive";
    ctx.textAlign = "center";
    ctx.fillStyle = "#7af6ff";
    ctx.fillText(String(Math.max(1, n)), w / 2 + 4, h / 2 + 4);
    ctx.fillStyle = "#ff2bd6";
    ctx.fillText(String(Math.max(1, n)), w / 2, h / 2);
    ctx.restore();
  }
}
