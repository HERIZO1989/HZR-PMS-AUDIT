import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          900: '#FFFFFF',
          800: '#F5F7F9',
          700: '#E2E8EE',
          600: '#C7D0D9',
          400: '#5B6B79',
        },
        parchment: '#152430',
        brass: {
          DEFAULT: '#0E6FA0',
          light: '#2E97C4',
          dim: '#0B5580',
        },
        wine: '#C0392B',
        ochre: '#B7791F',
        moss: '#2F7D4F',
        headerbar: '#0B3C5D',
      },
      fontFamily: {
        display: ['var(--font-plex)', 'sans-serif'],
        sans: ['var(--font-plex)', 'sans-serif'],
      },
      borderRadius: {
        none: '0px',
        sm: '2px',
        DEFAULT: '3px',
      },
    },
  },
  plugins: [],
};
export default config;
