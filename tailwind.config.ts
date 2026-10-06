import type { Config } from 'tailwindcss';

// Systeme visuel : encre marine pour l'ossature, acier pour les actions, laiton pour le seul accent de prestige.
// Les noms historiques (ink / parchment) sont conserves pour ne pas casser les ecrans ; ils designent une palette claire.
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          900: '#FFFFFF', // surface des panneaux
          800: '#F3F5F8', // fond de page
          700: '#DCE2E9', // filets
          600: '#C3CCD6', // bordures de champs
          500: '#8794A1', // texte discret (placeholders)
          400: '#566574', // texte secondaire
        },
        parchment: '#14212B', // texte principal
        navy: {
          DEFAULT: '#0B2A43',
          deep: '#081F33',
          line: '#1B4163',
        },
        steel: {
          DEFAULT: '#0E6FA0',
          light: '#2E8DBB',
          dim: '#0B5580',
          tint: '#E6F1F7',
        },
        brass: {
          DEFAULT: '#A8884F',
          light: '#C9AC72',
          tint: '#F5EFE2',
        },
        wine: { DEFAULT: '#B3362B', tint: '#FBEDEB' },
        ochre: { DEFAULT: '#A8681A', tint: '#FBF2E3' },
        moss: { DEFAULT: '#2A7248', tint: '#E8F4ED' },
        headerbar: '#0B2A43',
      },
      fontFamily: {
        display: ['var(--font-fraunces)', 'Georgia', 'serif'],
        sans: ['var(--font-plex)', 'sans-serif'],
      },
      borderRadius: {
        none: '0px',
        sm: '3px',
        DEFAULT: '4px',
        md: '6px',
      },
      boxShadow: {
        panel: '0 1px 2px rgba(11, 42, 67, 0.05)',
        pop: '0 8px 24px rgba(11, 42, 67, 0.14)',
      },
    },
  },
  plugins: [],
};
export default config;
