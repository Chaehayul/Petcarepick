import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated-client/client.js";
import { config } from "./config.js";

let client: PrismaClient | null = null;

export function databaseEnabled() {
  return Boolean(config.databaseUrl);
}

export function getDb() {
  if (!databaseEnabled()) return null;
  if (!client) {
    const adapter = new PrismaPg({
      connectionString: config.databaseUrl,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30000,
      max: 10,
    });
    client = new PrismaClient({ adapter });
  }
  return client;
}

export async function disconnectDb() {
  await client?.$disconnect();
  client = null;
}
