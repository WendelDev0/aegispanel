/** @type {import('tailwindcss').Config} */

/**
 * Aegis Command design tokens.
 *
 * Names match the design file (DESIGN.md) rather than being renamed to
 * something shorter: screens exported from the design tool use exactly these
 * class names, so they paste in without a translation step.
 *
 * The palette is a "Deep Carbon" tonal scale. Depth comes from layering
 * surfaces and 1px hairlines, never from shadows or gradients.
 */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Canvas and layered surfaces, darkest to lightest.
        surface: '#0d1321',
        'surface-container-lowest': '#080e1b',
        'surface-container-low': '#151b29',
        'surface-container': '#191f2d',
        'surface-container-high': '#242a38',
        'surface-container-highest': '#2f3543',
        'surface-bright': '#333948',

        // Text.
        'on-surface': '#dde2f6',
        'on-surface-variant': '#c2c6d6',

        // Hairlines. outline-variant is the structural grid; outline is for
        // elements that need to read as a real edge.
        outline: '#8c909f',
        'outline-variant': '#424754',

        // Brand.
        primary: '#adc6ff',
        'on-primary': '#002e6a',
        'primary-container': '#4d8eff',
        'on-primary-container': '#00285d',
        secondary: '#c0c1ff',
        tertiary: '#89ceff',

        // Semantic states, saturated so they carry against the dark surfaces.
        ok: '#34d399',
        warn: '#fbbf24',
        crit: '#f87171',

        // Kept so existing markup keeps rendering while pages migrate.
        brand: {
          50: '#eef2ff',
          100: '#e0e7ff',
          500: '#6366f1',
          600: '#4f46e5',
          700: '#4338ca',
          900: '#312e81',
          950: '#1e1b4b',
        },
        dark: {
          900: '#090d16',
          800: '#0f172a',
          700: '#1e293b',
          600: '#334155',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        // JetBrains Mono first: it is the face actually loaded in index.html.
        // Fira Code was listed ahead of it and is not loaded anywhere, so every
        // "technical data" label silently fell back to the browser default.
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Consolas', 'monospace'],
      },
      borderRadius: {
        // Soft level 1: enough to read as modern, rigid enough to keep the
        // grid-based, engineered feel.
        DEFAULT: '0.25rem',
        md: '0.375rem',
        lg: '0.5rem',
        xl: '0.75rem',
      },
      fontSize: {
        // Micro labels used for units and tabular metadata.
        '2xs': ['0.625rem', { lineHeight: '0.875rem' }],
      },
      maxWidth: {
        container: '1600px',
      },
    },
  },
  plugins: [],
}
