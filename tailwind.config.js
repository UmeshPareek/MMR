/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
        display: ['Space Grotesk', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      colors: {
        brand: {
          50:  '#f0fdfa',
          100: '#ccfbf1',
          200: '#99f6e4',
          300: '#5eead4',
          400: '#2dd4bf',
          500: '#14b8a6',
          600: '#0d9488',
          700: '#0f766e',
          800: '#115e59',
          900: '#134e4a',
          950: '#042f2e',
        },
        surface: {
          50:  '#f8fafc',
          100: '#f1f5f9',
          200: '#e2e8f0',
          300: '#cbd5e1',
          400: '#94a3b8',
          500: '#64748b',
          600: '#475569',
          700: '#334155',
          800: '#1e293b',
          850: '#172033',
          900: '#0f172a',
          950: '#080d1a',
        },
        income:  { light: '#dcfce7', DEFAULT: '#16a34a', dark: '#14532d', 400: '#4ade80', 500: '#22c55e' },
        expense: { light: '#fee2e2', DEFAULT: '#dc2626', dark: '#7f1d1d', 400: '#f87171', 500: '#ef4444' },
      },
      boxShadow: {
        'sm':         '0 1px 2px rgba(0,0,0,0.05)',
        'card':       '0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)',
        'card-hover': '0 4px 16px rgba(0,0,0,0.10)',
        'modal':      '0 24px 64px rgba(0,0,0,0.16)',
        'sidebar':    '1px 0 0 rgba(255,255,255,0.06)',
      },
      borderRadius: {
        DEFAULT: '0.5rem',
      },
      animation: {
        'fade-in':  'fadeIn 0.2s ease-out',
        'slide-up': 'slideUp 0.22s ease-out',
      },
      keyframes: {
        fadeIn:  { '0%': { opacity: '0' },                             '100%': { opacity: '1' } },
        slideUp: { '0%': { transform: 'translateY(8px)', opacity: '0' }, '100%': { transform: 'translateY(0)', opacity: '1' } },
      },
    },
  },
  plugins: [],
}
