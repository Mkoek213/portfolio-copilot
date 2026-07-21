"use client";

import { useEffect } from "react";
import { useTheme } from "next-themes";

/**
 * Keeps `<meta name="theme-color">` in sync with the resolved theme.
 *
 * The static `viewport.themeColor` export in `layout.tsx` only tracks the OS
 * preference (via `media` queries) - it can't reflect a manual in-app override.
 * This component prepends a media-less theme-color meta so it wins as the first
 * matching entry in tree order, and updates it whenever the resolved theme
 * changes.
 */
const THEME_COLOR = { light: "#f3f4f1", dark: "#121310" } as const;

export function ThemeColorSync() {
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    const color = resolvedTheme === "dark" ? THEME_COLOR.dark : THEME_COLOR.light;

    let meta = document.head.querySelector<HTMLMetaElement>('meta[name="theme-color"][data-dynamic="true"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.setAttribute("name", "theme-color");
      meta.setAttribute("data-dynamic", "true");
      document.head.prepend(meta);
    }
    meta.setAttribute("content", color);
  }, [resolvedTheme]);

  return null;
}
