export type Hero = {
  id: string;
  name: string;
  tag: string;
  color: string;
  accent: string;
  eye: string;
};

export const CAST: Hero[] = [
  { id: "miles", name: "Miles", tag: "Brooklyn", color: "#e10600", accent: "#111111", eye: "#f4f4f4" },
  { id: "gwen", name: "Gwen", tag: "Earth-65", color: "#f3c6de", accent: "#5b3f91", eye: "#fff7fb" },
  { id: "ink", name: "Ink", tag: "Original", color: "#7cff6b", accent: "#10240f", eye: "#ecffe8" },
  { id: "neon", name: "Neon", tag: "Original", color: "#ffe14a", accent: "#2b2200", eye: "#fff8d6" },
  { id: "static", name: "Static", tag: "Original", color: "#4ad6ff", accent: "#041826", eye: "#e8fbff" },
  { id: "pulse", name: "Pulse", tag: "Original", color: "#ff7a18", accent: "#2a1200", eye: "#ffe8d6" },
  { id: "spark", name: "Spark", tag: "Original", color: "#b84dff", accent: "#1a0828", eye: "#f6e8ff" },
  { id: "glitch", name: "Glitch", tag: "Original", color: "#ff4ad2", accent: "#240018", eye: "#ffe6f7" },
  { id: "chorus", name: "Chorus", tag: "Original", color: "#7aa7ff", accent: "#0b1230", eye: "#eaf0ff" },
  { id: "ballet", name: "Ballet", tag: "Original", color: "#ffffff", accent: "#c45c9a", eye: "#fff0f7" },
];

export function heroById(id: string): Hero {
  return CAST.find((h) => h.id === id) ?? CAST[0];
}
