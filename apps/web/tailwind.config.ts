import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";

const config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {},
  },
  plugins: [animate],
} satisfies Config;

export default config;
