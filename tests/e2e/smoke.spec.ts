import { test, expect, type ConsoleMessage } from "@playwright/test";

/**
 * Phase-11 smoke: every `?tab=` value renders its topbar heading and produces
 * zero console errors. Later phases extend this suite (dark-mode toggle,
 * per-tab Server Action round-trips, destructive-action confirms).
 */
const TABS: ReadonlyArray<readonly [tab: string, heading: string]> = [
  ["overview", "Overview"],
  ["transactions", "Transactions"],
  ["reports", "Reports"],
  ["imports", "Imports"],
  ["strategy", "Strategy"],
  ["memory", "Memory"],
  ["chat", "Chat"],
  ["settings", "Settings"]
];

for (const [tab, heading] of TABS) {
  test(`tab "${tab}" shows its heading with no console errors`, async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (msg: ConsoleMessage) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    page.on("pageerror", (error: Error) => errors.push(error.message));

    await page.goto(`/?tab=${tab}`, { waitUntil: "networkidle" });

    await expect(page.locator(".topbar-title h1")).toHaveText(heading);
    expect(errors, `console errors on ?tab=${tab}:\n${errors.join("\n")}`).toHaveLength(0);
  });
}
