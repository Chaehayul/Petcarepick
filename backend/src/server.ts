import { createApp } from "./app.js";
import { config } from "./config.js";
import { disconnectDb } from "./db.js";

const server = createApp().listen(config.port, () => {
  console.log(`Petcarepick backend: http://localhost:${config.port}`);
});

async function shutdown(signal: string) {
  console.log(`${signal} received. Shutting down.`);
  server.close(async () => {
    await disconnectDb();
    process.exit(0);
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
