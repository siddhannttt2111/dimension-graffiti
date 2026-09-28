import { useEffect, useMemo, useRef, useState } from "react";
import { CAST, heroById } from "./cast";
import { Match, type ScoreRow } from "./game/engine";
import { RoomClient, type RelayMsg } from "./net/client";
import type { Difficulty, GameMode, InputState, MatchConfig, PlayerSetup, RosterPlayer } from "./types";
import { EMPTY_INPUT } from "./types";

type Screen = "home" | "setup" | "join" | "lobby" | "play";

function uid() {
  return `p-${Math.random().toString(36).slice(2, 9)}`;
}

export default function App() {
  const [screen, setScreen] = useState<Screen>("home");
  const [intent, setIntent] = useState<"now" | "create">("now");
  const [name, setName] = useState("Miles");
  const [characterId, setCharacterId] = useState("miles");
  const [mode, setMode] = useState<GameMode>("both");
  const [difficulty, setDifficulty] = useState<Difficulty>("street");
  const [totalSlots, setTotalSlots] = useState(6);
  const [fillBots, setFillBots] = useState(true);
  const [joinCode, setJoinCode] = useState("");
  const [error, setError] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [roster, setRoster] = useState<RosterPlayer[]>([]);
  const [hostId, setHostId] = useState("");
  const [matchCfg, setMatchCfg] = useState<MatchConfig | null>(null);
  const [isHost, setIsHost] = useState(true);
  const roomRef = useRef<RoomClient | null>(null);

  useEffect(() => {
    if (characterId === "miles" && name === "Miles") return;
    if (characterId === "gwen" && (name === "Miles" || name === "Gwen")) setName("Gwen");
  }, [characterId, name]);

  const localId = useMemo(() => uid(), []);

  async function ensureRoom() {
    if (!roomRef.current) roomRef.current = new RoomClient();
    const room = roomRef.current;
    room.id = room.id || localId;
    room.onError = (m) => setError(m);
    room.onJoined = (code, hid) => {
      setRoomCode(code);
      setHostId(hid);
      setScreen("lobby");
    };
    room.onRoster = (players, hid) => {
      setRoster(players);
      if (hid) setHostId(hid);
    };
    await room.connect();
    return room;
  }

  async function createRoom() {
    setError("");
    try {
      const room = await ensureRoom();
      room.onRelay = (from, payload) => handleRelay(from, payload);
      room.create(name, characterId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create a room.");
    }
  }

  async function joinRoom() {
    setError("");
    try {
      const room = await ensureRoom();
      room.onRelay = (from, payload) => handleRelay(from, payload);
      room.join(joinCode, name, characterId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not join.");
    }
  }

  function handleRelay(_from: string, payload: RelayMsg) {
    if (payload.kind === "start") {
      const room = roomRef.current;
      if (!room) return;
      const players: PlayerSetup[] = room.players.map((p) => ({
        id: p.id,
        name: p.name,
        characterId: p.characterId,
      }));
      setIsHost(room.isHost);
      setMatchCfg({
        seed: payload.seed,
        mode: payload.mode as GameMode,
        difficulty: payload.difficulty as Difficulty,
        totalSlots: payload.totalSlots,
        fillBots: payload.fillBots,
        localId: room.id,
        players,
      });
      setScreen("play");
    }
  }

  function playNow() {
    const players: PlayerSetup[] = [
      { id: localId, name, characterId },
    ];
    setIsHost(true);
    setMatchCfg({
      seed: Math.floor(Math.random() * 1e9),
      mode,
      difficulty,
      totalSlots,
      fillBots,
      localId,
      players,
    });
    setScreen("play");
  }

  function startHostMatch() {
    const room = roomRef.current;
    if (!room) return;
    const seed = Math.floor(Math.random() * 1e9);
    room.relay({
      kind: "start",
      seed,
      mode,
      difficulty,
      totalSlots,
      fillBots,
    });
    const players: PlayerSetup[] = room.players.map((p) => ({
      id: p.id,
      name: p.name,
      characterId: p.characterId,
    }));
    setIsHost(true);
    setMatchCfg({
      seed,
      mode,
      difficulty,
      totalSlots,
      fillBots,
      localId: room.id,
      players,
    });
    setScreen("play");
  }

  function leavePlay() {
    setMatchCfg(null);
    if (roomRef.current?.code) setScreen("lobby");
    else setScreen("home");
  }

  return (
    <>
      <div className="halftone" />
      <div className="split" />
      {screen === "home" && (
        <Home
          onPlay={() => {
            setIntent("now");
            setScreen("setup");
          }}
          onCreate={() => {
            setIntent("create");
            setScreen("setup");
          }}
          onJoin={() => setScreen("join")}
        />
      )}
      {screen === "setup" && (
        <Setup
          name={name}
          characterId={characterId}
          mode={mode}
          difficulty={difficulty}
          totalSlots={totalSlots}
          fillBots={fillBots}
          intent={intent}
          onName={setName}
          onHero={setCharacterId}
          onMode={setMode}
          onDiff={setDifficulty}
          onSlots={setTotalSlots}
          onBots={setFillBots}
          onBack={() => setScreen("home")}
          onGo={() => (intent === "now" ? playNow() : createRoom())}
          error={error}
        />
      )}
      {screen === "join" && (
        <Join
          name={name}
          characterId={characterId}
          joinCode={joinCode}
          error={error}
          onName={setName}
          onHero={setCharacterId}
          onCode={setJoinCode}
          onBack={() => setScreen("home")}
          onGo={joinRoom}
        />
      )}
      {screen === "lobby" && (
        <Lobby
          code={roomCode || roomRef.current?.code || ""}
          roster={roster.length ? roster : roomRef.current?.players ?? []}
          isHost={roomRef.current?.isHost ?? hostId === roomRef.current?.id}
          onStart={startHostMatch}
          onBack={() => {
            roomRef.current?.close();
            roomRef.current = null;
            setScreen("home");
          }}
        />
      )}
      {screen === "play" && matchCfg && (
        <Play
          config={matchCfg}
          host={isHost}
          room={roomRef.current}
          onLeave={leavePlay}
        />
      )}
    </>
  );
}

function Home({
  onPlay,
  onCreate,
  onJoin,
}: {
  onPlay: () => void;
  onCreate: () => void;
  onJoin: () => void;
}) {
  return (
    <div className="screen">
      <div className="brand">
        <p className="eyebrow">Miles · Gwen · Across the skyline</p>
        <h1 className="logo">
          Dimension
          <br />
          Graffiti
        </h1>
        <p className="tagline">
          Swing Brooklyn rooftops, paint the city your color, then race a glitch-portal.
          One player vs bots. Or a room of up to ten.
        </p>
      </div>
      <div className="row">
        <button className="btn mag" onClick={onPlay}>
          Play now
        </button>
        <button className="btn cyan" onClick={onCreate}>
          Create room
        </button>
        <button className="btn ghost" onClick={onJoin}>
          Join room
        </button>
      </div>
    </div>
  );
}

function HeroPicker({
  characterId,
  onHero,
}: {
  characterId: string;
  onHero: (id: string) => void;
}) {
  return (
    <div className="grid">
      {CAST.map((h) => (
        <button
          key={h.id}
          className={`hero ${characterId === h.id ? "on" : ""}`}
          onClick={() => onHero(h.id)}
        >
          <div className="swatch" style={{ background: `linear-gradient(90deg, ${h.color}, ${h.accent})` }} />
          <strong>{h.name}</strong>
          <div className="hint">{h.tag}</div>
        </button>
      ))}
    </div>
  );
}

function Setup(props: {
  name: string;
  characterId: string;
  mode: GameMode;
  difficulty: Difficulty;
  totalSlots: number;
  fillBots: boolean;
  intent: "now" | "create";
  error: string;
  onName: (v: string) => void;
  onHero: (v: string) => void;
  onMode: (v: GameMode) => void;
  onDiff: (v: Difficulty) => void;
  onSlots: (v: number) => void;
  onBots: (v: boolean) => void;
  onBack: () => void;
  onGo: () => void;
}) {
  return (
    <div className="screen">
      <div className="brand">
        <p className="eyebrow">{props.intent === "now" ? "Solo / bots" : "Host a room"}</p>
        <h1 className="logo">Suit up</h1>
      </div>
      <div className="panel">
        <label className="field">
          Callsign
          <input value={props.name} maxLength={16} onChange={(e) => props.onName(e.target.value)} />
        </label>
        <p className="hint">Pick a spider. Miles and Gwen lead; originals fill a 10-player skyline.</p>
        <HeroPicker
          characterId={props.characterId}
          onHero={(id) => {
            props.onHero(id);
            const h = heroById(id);
            if (props.name === "Miles" || props.name === "Gwen" || CAST.some((c) => c.name === props.name)) {
              props.onName(h.name);
            }
          }}
        />
        <label className="field">
          Mode
          <select value={props.mode} onChange={(e) => props.onMode(e.target.value as GameMode)}>
            <option value="both">Both — graffiti, then race</option>
            <option value="tag">Dimension Graffiti only</option>
            <option value="race">Multiverse Sprint only</option>
          </select>
        </label>
        <label className="field">
          Heat
          <select value={props.difficulty} onChange={(e) => props.onDiff(e.target.value as Difficulty)}>
            <option value="chill">Chill</option>
            <option value="street">Street</option>
            <option value="verse">Spider-Verse</option>
          </select>
        </label>
        <label className="field">
          Spiders in the match (1–10)
          <input
            type="number"
            min={1}
            max={10}
            value={props.totalSlots}
            onChange={(e) => props.onSlots(clamp(Number(e.target.value) || 1, 1, 10))}
          />
        </label>
        <label className="field" style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <input type="checkbox" checked={props.fillBots} onChange={(e) => props.onBots(e.target.checked)} />
          Fill empty slots with bots
        </label>
        {props.error && <p style={{ color: "#ff6b9d" }}>{props.error}</p>}
        <div className="row">
          <button className="btn ghost" onClick={props.onBack}>
            Back
          </button>
          <button className="btn mag" onClick={props.onGo}>
            {props.intent === "now" ? "Swing" : "Open room"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Join(props: {
  name: string;
  characterId: string;
  joinCode: string;
  error: string;
  onName: (v: string) => void;
  onHero: (v: string) => void;
  onCode: (v: string) => void;
  onBack: () => void;
  onGo: () => void;
}) {
  return (
    <div className="screen">
      <div className="brand">
        <p className="eyebrow">Drop into a dimension</p>
        <h1 className="logo">Join</h1>
      </div>
      <div className="panel">
        <label className="field">
          Room code
          <input
            value={props.joinCode}
            maxLength={6}
            onChange={(e) => props.onCode(e.target.value.toUpperCase())}
            placeholder="X7QK"
          />
        </label>
        <label className="field">
          Callsign
          <input value={props.name} maxLength={16} onChange={(e) => props.onName(e.target.value)} />
        </label>
        <HeroPicker characterId={props.characterId} onHero={props.onHero} />
        {props.error && <p style={{ color: "#ff6b9d" }}>{props.error}</p>}
        <div className="row">
          <button className="btn ghost" onClick={props.onBack}>
            Back
          </button>
          <button className="btn cyan" onClick={props.onGo} disabled={props.joinCode.length < 4}>
            Hop in
          </button>
        </div>
      </div>
    </div>
  );
}

function Lobby({
  code,
  roster,
  isHost,
  onStart,
  onBack,
}: {
  code: string;
  roster: RosterPlayer[];
  isHost: boolean;
  onStart: () => void;
  onBack: () => void;
}) {
  return (
    <div className="screen">
      <div className="brand">
        <p className="eyebrow">Share this code</p>
        <div className="code">{code || "····"}</div>
        <p className="tagline">Same Wi-Fi or same internet. Up to 10 spiders.</p>
      </div>
      <div className="panel">
        {roster.map((p) => {
          const h = heroById(p.characterId);
          return (
            <div key={p.id} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0" }}>
              <span>
                <b style={{ color: h.color }}>{p.name}</b> · {h.name}
              </span>
              {p.host ? <span className="hint">host</span> : null}
            </div>
          );
        })}
        <div className="row">
          <button className="btn ghost" onClick={onBack}>
            Leave
          </button>
          {isHost && (
            <button className="btn mag" onClick={onStart} disabled={roster.length < 1}>
              Start match
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Play({
  config,
  host,
  room,
  onLeave,
}: {
  config: MatchConfig;
  host: boolean;
  room: RoomClient | null;
  onLeave: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const matchRef = useRef<Match | null>(null);
  const inputRef = useRef<InputState>({ ...EMPTY_INPUT });
  const [hud, setHud] = useState<ReturnType<Match["hud"]> | null>(null);
  const [over, setOver] = useState<ScoreRow[] | null>(null);
  const [touch, setTouch] = useState(false);

  useEffect(() => {
    setTouch(window.matchMedia("(pointer: coarse)").matches || window.innerWidth < 820);
    const canvas = canvasRef.current;
    if (!canvas) return;
    const match = new Match(canvas, config, host);
    matchRef.current = match;
    match.onHud = () => {
      const h = match.hud();
      setHud(h);
      if (h.phase === "done") setOver(match.scores());
    };
    match.onOver = (rows) => setOver(rows);
    match.start();

    const keys = new Set<string>();
    const sync = () => {
      const inp = inputRef.current;
      inp.left = keys.has("a") || keys.has("arrowleft");
      inp.right = keys.has("d") || keys.has("arrowright");
      inp.jump = keys.has("w") || keys.has(" ") || keys.has("arrowup");
      inp.spray = keys.has("e") || keys.has("shift");
      match.setLocalInput({ ...inp });
    };

    const down = (e: KeyboardEvent) => {
      keys.add(e.key.toLowerCase());
      if ([" ", "arrowup", "arrowdown"].includes(e.key.toLowerCase())) e.preventDefault();
      sync();
    };
    const up = (e: KeyboardEvent) => {
      keys.delete(e.key.toLowerCase());
      sync();
    };
    const move = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      const viewW = (canvas.width / canvas.height) * 780 || r.width;
      const viewH = 780;
      const mx = ((e.clientX - r.left) / r.width) * viewW + match.cameraX;
      const my = ((e.clientY - r.top) / r.height) * viewH + match.cameraY;
      inputRef.current.aimX = mx;
      inputRef.current.aimY = my;
      sync();
    };
    const pdown = (e: PointerEvent) => {
      if (e.button === 0 && e.target === canvas) {
        inputRef.current.web = true;
        move(e);
      }
    };
    const pup = () => {
      inputRef.current.web = false;
      sync();
    };

    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerdown", pdown);
    window.addEventListener("pointerup", pup);

    let snapTimer = 0;
    let inTimer = 0;
    if (room && host) {
      snapTimer = window.setInterval(() => {
        room.relay({ kind: "state", snap: match.snapshot() });
      }, 70);
    }
    if (room) {
      inTimer = window.setInterval(() => {
        room.relay({ kind: "input", input: { ...inputRef.current } });
      }, 50);
      const prev = room.onRelay;
      room.onRelay = (from, payload) => {
        prev?.(from, payload);
        if (payload.kind === "input" && host && from !== room.id) {
          match.setRemoteInput(from, payload.input);
        }
        if (payload.kind === "state" && !host) {
          match.applySnapshot(payload.snap as ReturnType<Match["snapshot"]>);
        }
      };
    }

    return () => {
      match.destroy();
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerdown", pdown);
      window.removeEventListener("pointerup", pup);
      window.clearInterval(snapTimer);
      window.clearInterval(inTimer);
    };
  }, [config, host, room]);

  const hold = (key: keyof InputState, v: boolean) => {
    if (key === "aimX" || key === "aimY") return;
    inputRef.current[key] = v;
    matchRef.current?.setLocalInput({ ...inputRef.current });
  };

  const phaseLabel =
    hud?.phase === "tag"
      ? "GRAFFITI"
      : hud?.phase === "race"
        ? "SPRINT"
        : hud?.phase === "tag_results"
          ? "NEXT: RACE"
          : hud?.phase === "countdown"
            ? "LOCK IN"
            : "DONE";

  const clock =
    hud?.phase === "tag"
      ? fmt(hud.tagTime)
      : hud?.phase === "race"
        ? fmt(hud.raceTime)
        : hud?.phase === "countdown" || hud?.phase === "tag_results"
          ? fmt(hud.time)
          : "";

  return (
    <div className="play">
      <canvas ref={canvasRef} />
      <div className="hud">
        <div className="hud-top">
          <div className="chip">
            {phaseLabel} {clock}
            {hud && (hud.phase === "race" || config.mode !== "tag") && hud.phase !== "tag" ? (
              <span>
                {" "}
                · CP {hud.checkpoints}/{hud.totalCk}
              </span>
            ) : null}
          </div>
          <div className="bars">
            {hud?.scores.map((s) => (
              <div
                key={s.id}
                title={s.name}
                style={{
                  flex: Math.max(1, config.mode === "race" ? s.raceScore : s.tagScore),
                  background: s.color,
                }}
              />
            ))}
          </div>
          <button className="chip" onClick={onLeave}>
            Leave
          </button>
        </div>
        {!touch && (
          <div className="chip" style={{ position: "absolute", left: 18, bottom: 18 }}>
            A/D move · W/Space jump · hold click web · E spray
          </div>
        )}
      </div>
      {touch && (
        <div className="touch">
          <div className="pad">
            <button className="ctl" onPointerDown={() => hold("left", true)} onPointerUp={() => hold("left", false)}>
              ◀
            </button>
            <button className="ctl" onPointerDown={() => hold("right", true)} onPointerUp={() => hold("right", false)}>
              ▶
            </button>
          </div>
          <div className="acts">
            <button className="ctl" onPointerDown={() => hold("spray", true)} onPointerUp={() => hold("spray", false)}>
              SPRAY
            </button>
            <button className="ctl" onPointerDown={() => hold("web", true)} onPointerUp={() => hold("web", false)}>
              WEB
            </button>
            <button className="ctl" onPointerDown={() => hold("jump", true)} onPointerUp={() => hold("jump", false)}>
              JUMP
            </button>
          </div>
        </div>
      )}
      {over && (
        <div className="results">
          <div className="board">
            <p className="eyebrow">Across the scoreboard</p>
            <h2 style={{ fontFamily: "Bangers, cursive", fontSize: 42, margin: 0 }}>That&apos;s a wrap</h2>
            <ol>
              {over.map((s) => (
                <li key={s.id}>
                  <span>
                    {s.place}. <b style={{ color: s.color }}>{s.name}</b>
                  </span>
                  <span>
                    {config.mode !== "race" ? `tag ${s.tagScore}` : ""}
                    {config.mode !== "tag" ? `  race ${s.raceScore}` : ""}
                  </span>
                </li>
              ))}
            </ol>
            <div className="row">
              <button className="btn mag" onClick={onLeave}>
                Again
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function fmt(n: number) {
  const s = Math.max(0, Math.ceil(n));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}
