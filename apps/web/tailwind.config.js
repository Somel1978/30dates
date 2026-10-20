/**
 * Design tokens: a private members' lounge, not a casino. Muted, warm, editorial.
 *
 * Raw palette (fixed hex values) plus semantic tokens backed by CSS variables so every
 * component works in both the dark (default) and light editorial modes.
 * @type {import('tailwindcss').Config}
 */
module.exports = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Raw palette
        bg: '#0F1115',
        surface: '#12161F',
        'bg-light': '#F8F7F4',
        terracotta: { DEFAULT: '#C86D51', soft: '#D88B72', deep: '#A9573E' },
        gold: { DEFAULT: '#D4AF37', soft: '#E2C766', deep: '#A8892A' },
        forest: { DEFAULT: '#2A3B3C', soft: '#3B5253', deep: '#1E2A2B' },
        // Semantic, theme-aware tokens
        canvas: 'rgb(var(--color-canvas) / <alpha-value>)',
        panel: 'rgb(var(--color-panel) / <alpha-value>)',
        raised: 'rgb(var(--color-raised) / <alpha-value>)',
        ink: 'rgb(var(--color-ink) / <alpha-value>)',
        muted: 'rgb(var(--color-muted) / <alpha-value>)',
        line: 'rgb(var(--color-line) / <alpha-value>)',
        accent: 'rgb(var(--color-accent) / <alpha-value>)',
        brass: 'rgb(var(--color-brass) / <alpha-value>)',
        pine: 'rgb(var(--color-forest) / <alpha-value>)',
      },
      fontFamily: {
        serif: ['var(--font-serif)', 'Cormorant Garamond', 'Playfair Display', 'Georgia', 'serif'],
        sans: ['var(--font-sans)', 'Inter', 'Plus Jakarta Sans', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        // Generous line heights throughout.
        xs: ['0.8125rem', { lineHeight: '1.6' }],
        sm: ['0.9375rem', { lineHeight: '1.65' }],
        base: ['1.0625rem', { lineHeight: '1.75' }],
        lg: ['1.1875rem', { lineHeight: '1.7' }],
        xl: ['1.375rem', { lineHeight: '1.5' }],
        '2xl': ['1.75rem', { lineHeight: '1.35' }],
        '3xl': ['2.25rem', { lineHeight: '1.2' }],
        '4xl': ['2.5rem', { lineHeight: '1.1' }],
      },
      letterSpacing: {
        eyebrow: '0.18em',
      },
      spacing: {
        touch: '48px',
      },
      minHeight: {
        touch: '48px',
      },
      minWidth: {
        touch: '48px',
      },
      borderRadius: {
        card: '1.25rem',
        sheet: '1.75rem',
      },
      boxShadow: {
        card: '0 1px 0 rgb(255 255 255 / 0.04) inset, 0 14px 30px -18px rgb(0 0 0 / 0.7)',
        sheet: '0 -24px 60px -20px rgb(0 0 0 / 0.6)',
      },
      transitionTimingFunction: {
        calm: 'cubic-bezier(0.22, 1, 0.36, 1)',
      },
      keyframes: {
        'stamp-press': {
          '0%': { transform: 'scale(1.6) rotate(-14deg)', opacity: '0' },
          '55%': { transform: 'scale(0.92) rotate(-6deg)', opacity: '1' },
          '100%': { transform: 'scale(1) rotate(-8deg)', opacity: '1' },
        },
        'sheet-up': {
          '0%': { transform: 'translateY(100%)' },
          '100%': { transform: 'translateY(0)' },
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'press-ring': {
          '0%': { transform: 'scaleX(0)' },
          '100%': { transform: 'scaleX(1)' },
        },
      },
      animation: {
        'stamp-press': 'stamp-press 420ms cubic-bezier(0.22, 1, 0.36, 1) both',
        'sheet-up': 'sheet-up 320ms cubic-bezier(0.22, 1, 0.36, 1) both',
        'fade-in': 'fade-in 240ms ease-out both',
        'press-ring': 'press-ring 450ms linear both',
      },
    },
  },
  plugins: [],
};
