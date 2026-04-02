import type { Config } from 'tailwindcss';

export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        triova: { 50: '#f0fdf9', 500: '#0d9488', 700: '#0f766e', 900: '#134e4a' },
      },
    },
  },
  plugins: [],
} satisfies Config;
