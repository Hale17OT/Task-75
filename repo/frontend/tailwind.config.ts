import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{vue,ts}"],
  theme: {
    extend: {
      colors: {
        surface: "var(--color-surface)",
        panel: "var(--color-panel)",
        accent: "var(--color-accent)",
        success: "var(--color-success)",
        warning: "var(--color-warning)",
        danger: "var(--color-danger)",
        ink: "var(--color-ink)",
        muted: "var(--color-muted)"
      },
      boxShadow: {
        soft: "0 18px 48px rgba(15, 23, 42, 0.12)"
      },
      fontFamily: {
        ui: ["Segoe UI", "Tahoma", "sans-serif"]
      }
    }
  },
  plugins: []
} satisfies Config;

