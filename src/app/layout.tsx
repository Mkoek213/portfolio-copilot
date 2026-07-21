import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./legacy.css";
import { ThemeProvider } from "./components/theme-provider";
import { ThemeColorSync } from "./components/theme-color-sync";

export const metadata: Metadata = {
  title: "Portfolio Copilot",
  description: "Local read-only financial cockpit with imports, reports, memory and chat"
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f3f4f1" },
    { media: "(prefers-color-scheme: dark)", color: "#121310" }
  ]
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pl" suppressHydrationWarning>
      <body>
        <ThemeProvider>
          <div className="ambient-bg" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <ThemeColorSync />
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
