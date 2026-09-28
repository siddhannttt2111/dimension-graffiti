export type GameMode = "tag" | "race" | "both";
export type Difficulty = "chill" | "street" | "verse";
export type Phase = "countdown" | "tag" | "tag_results" | "race" | "done";

export type PlayerSetup = {
  id: string;
  name: string;
  characterId: string;
  bot?: boolean;
};

export type InputState = {
  left: boolean;
  right: boolean;
  jump: boolean;
  spray: boolean;
  web: boolean;
  aimX: number;
  aimY: number;
};

export const EMPTY_INPUT: InputState = {
  left: false,
  right: false,
  jump: false,
  spray: false,
  web: false,
  aimX: 0,
  aimY: 0,
};

export type MatchConfig = {
  seed: number;
  mode: GameMode;
  difficulty: Difficulty;
  totalSlots: number;
  fillBots: boolean;
  players: PlayerSetup[];
  localId: string;
};

export type RosterPlayer = {
  id: string;
  name: string;
  characterId: string;
  host?: boolean;
};
