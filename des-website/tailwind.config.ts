import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "#04070C",
          900: "#070C15",
          850: "#0A1120",
          800: "#0D1626",
          700: "#131F35",
          600: "#1B2A47",
        },
        mist: {
          400: "#5B6B84",
          300: "#8492A6",
          200: "#AEB9C8",
          100: "#DCE2EA",
          50: "#F4F6F9",
        },
        solar: {
          300: "#FBD08A",
          400: "#F5B84C",
          500: "#EE9F2E",
          600: "#D9821A",
        },
        volt: {
          300: "#7FF4C8",
          400: "#3EE3A6",
          500: "#1FC98A",
          600: "#0FA870",
        },
        arc: {
          400: "#7DD3FC",
          500: "#38BDF8",
          600: "#0EA5E9",
        },
      },
      fontFamily: {
        display: ["var(--font-display)", "sans-serif"],
        body: ["var(--font-body)", "sans-serif"],
      },
      backgroundImage: {
        "grid-fine":
          "linear-gradient(to right, rgba(255,255,255,0.045) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.045) 1px, transparent 1px)",
        "radial-fade":
          "radial-gradient(60% 60% at 50% 0%, rgba(238,159,46,0.16) 0%, rgba(4,7,12,0) 70%)",
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(255,255,255,0.06), 0 20px 60px -20px rgba(0,0,0,0.6)",
        "glow-solar": "0 0 40px -8px rgba(238,159,46,0.45)",
        "glow-volt": "0 0 40px -8px rgba(31,201,138,0.4)",
      },
      animation: {
        marquee: "marquee 32s linear infinite",
        "spin-slow": "spin 18s linear infinite",
        float: "float 6s ease-in-out infinite",
      },
      keyframes: {
        marquee: {
          "0%": { transform: "translateX(0)" },
          "100%": { transform: "translateX(-50%)" },
        },
        float: {
          "0%, 100%": { transform: "translateY(0px)" },
          "50%": { transform: "translateY(-14px)" },
        },
      },
    },
  },
  plugins: [],
};
export default config;
