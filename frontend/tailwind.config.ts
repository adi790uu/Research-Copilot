import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Helvetica Neue",
          "sans-serif",
        ],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      colors: {
        ink: {
          50: "#f8f8f7",
          100: "#eeeeec",
          200: "#d8d8d4",
          300: "#b8b8b1",
          400: "#8e8e85",
          500: "#6b6b62",
          600: "#4d4d46",
          700: "#34342f",
          800: "#22221f",
          900: "#141413",
          950: "#0a0a09",
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
