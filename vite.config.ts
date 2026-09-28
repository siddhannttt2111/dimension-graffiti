import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { roomRelay } from "./relay-plugin";

export default defineConfig({
  plugins: [react(), roomRelay()],
  server: {
    port: 5173,
  },
  preview: {
    port: 5173,
  },
});
