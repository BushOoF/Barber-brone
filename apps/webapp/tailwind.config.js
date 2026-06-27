/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        tg: {
          bg: "var(--tg-bg)",
          text: "var(--tg-text)",
          hint: "var(--tg-hint)",
          link: "var(--tg-link)",
          button: "var(--tg-button)",
          buttonText: "var(--tg-button-text)",
          secondary: "var(--tg-secondary)",
          destructive: "var(--tg-destructive)",
        },
        surface: {
          1: "var(--surface-1)",
          2: "var(--surface-2)",
        },
        line: {
          soft: "var(--line-soft)",
          strong: "var(--line-strong)",
        },
        // Semantic status colours (theme-independent). Channel vars live in
        // styles.css so the `/opacity` modifier works: bg-success/10, ring-warning/30…
        success: "rgb(var(--success) / <alpha-value>)",
        warning: "rgb(var(--warning) / <alpha-value>)",
      },
      // 3.25rem (52px) fills the gap between h-12 and h-14, giving the `lg`
      // button a real fixed height instead of silently collapsing to padding.
      spacing: {
        13: "3.25rem",
      },
      boxShadow: {
        soft: "var(--shadow-soft)",
        pop: "var(--shadow-pop)",
      },
      fontFamily: {
        sans: ["-apple-system", "BlinkMacSystemFont", "Segoe UI", "Roboto", "sans-serif"],
      },
      transitionTimingFunction: {
        spring: "cubic-bezier(0.34, 1.56, 0.64, 1)",
      },
    },
  },
  plugins: [],
};
