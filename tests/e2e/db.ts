import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";

// Playwright runs specs in a bare Node process that (unlike `next dev`) does not
// auto-load .env, so surface DATABASE_URL from the project's .env before
// constructing the client the seed helpers use.
if (!process.env.DATABASE_URL) {
  try {
    const match = readFileSync(join(process.cwd(), ".env"), "utf8").match(/^\s*DATABASE_URL\s*=\s*"?([^"\n]+)"?/m);
    if (match) {
      process.env.DATABASE_URL = match[1];
    }
  } catch {
    // Leave DATABASE_URL unset; PrismaClient throws a clear error if still missing.
  }
}

export const prisma = new PrismaClient();

export const E2E_RESOURCE_ID = "local-user";
