"use client";

import type { ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";

/**
 * Animation shell for tab switches. `page.tsx` is an async Server Component, so
 * this small client wrapper receives the already-rendered tab JSX as `children`
 * and owns only the entrance transition (replacing the old CSS `content-in`
 * keyframe). Keyed on the active tab so each navigation re-runs the entrance.
 */
export function TabTransition({ tabKey, children }: { tabKey: string; children: ReactNode }) {
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={tabKey}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 4 }}
        transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
        className="grid content-start gap-[18px]"
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
