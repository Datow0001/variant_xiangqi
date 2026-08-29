/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{vue,js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        wood: {
          light: '#f5deb3',
          DEFAULT: '#e6c280',
          dark: '#b38241',
          border: '#6d4218',
        }
      }
    },
  },
  plugins: [],
}
