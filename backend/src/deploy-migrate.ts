import { spawnSync } from "node:child_process";
import { config } from "./config.js";

if (!config.databaseUrl) {
  console.log("DATABASE_URL is not configured. Skipping Prisma migrations.");
  process.exit(0);
}

const command = process.platform === "win32" ? "npx.cmd" : "npx";
const result = spawnSync(command, ["prisma", "migrate", "deploy"], {
  stdio: "inherit",
  env: process.env,
});

process.exit(result.status ?? 1);
