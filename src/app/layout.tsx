import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Portfolio Copilot",
  description: "Local read-only financial cockpit with imports, reports, memory and chat"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pl">
      <body>
        <div className="ambient-bg" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        {children}
      </body>
    </html>
  );
}
