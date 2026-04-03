/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    './app/**/*.{js,jsx,ts,tsx}',
    './components/**/*.{js,jsx,ts,tsx}',
    './lib/**/*.{js,jsx,ts,tsx}',
    './services/**/*.{js,jsx,ts,tsx}',
  ],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        primary: '#007AFF',
        label: '#1C1C1E',
        secondaryLabel: '#8E8E93',
        separator: '#E5E5EA',
        systemBackground: '#FFFFFF',
        systemGray6: '#F2F2F7',
        systemGray5: '#E5E5EA',
      },
    },
  },
  plugins: [],
};
