import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          900: '#14171B',
          800: '#1C2027',
          700: '#262B34',
          600: '#343B47',
          400: '#6B7280',
        },
        parchment: '#EDE7D9',
        brass: {
          DEFAULT: '#B08D57',
          light: '#CBA97A',
          dim: '#8A6F44',
        },
        wine: '#7A3030',
        ochre: '#A6772E',
        moss: '#5C7A5C',
      },
      fontFamily: {
        display: ['var(--font-fraunces)', 'serif'],
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
