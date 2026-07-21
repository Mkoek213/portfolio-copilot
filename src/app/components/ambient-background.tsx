"use client";

import { motion, useReducedMotion } from "motion/react";

/**
 * Ambient drifting colour blobs behind the app shell. Formerly three CSS
 * `@keyframes drift-*` spans; now `motion` so `useReducedMotion()` can pause
 * them for users who ask for reduced motion (JS-driven, not the CSS-only
 * `prefers-reduced-motion` block).
 */
const BLOBS = [
  {
    className: "left-[-12%] top-[-18%] h-[46vw] w-[46vw] bg-[#0b5f58]",
    animate: { x: ["0vw", "6vw", "0vw"], y: ["0vh", "5vh", "0vh"], scale: [1, 1.08, 1] },
    duration: 64
  },
  {
    className: "right-[-14%] top-[8%] h-[38vw] w-[38vw] bg-[#eda100]",
    animate: { x: ["0vw", "-5vw", "0vw"], y: ["0vh", "6vh", "0vh"], scale: [1, 0.94, 1] },
    duration: 78
  },
  {
    className: "bottom-[-20%] left-[22%] h-[42vw] w-[42vw] bg-[#4a3aa7]",
    animate: { x: ["0vw", "4vw", "0vw"], y: ["0vh", "-5vh", "0vh"], scale: [1, 1.06, 1] },
    duration: 90
  }
];

export function AmbientBackground() {
  const reduceMotion = useReducedMotion();

  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden="true">
      {BLOBS.map((blob, index) => (
        <motion.span
          key={index}
          className={`absolute rounded-full opacity-[0.22] blur-[90px] will-change-transform ${blob.className}`}
          animate={reduceMotion ? undefined : blob.animate}
          transition={reduceMotion ? undefined : { duration: blob.duration, repeat: Infinity, ease: "easeInOut" }}
        />
      ))}
    </div>
  );
}
