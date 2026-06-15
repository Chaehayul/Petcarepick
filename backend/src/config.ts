import "dotenv/config";

const production = process.env.NODE_ENV === "production";

export const config = {
  port: Number(process.env.PORT || 8787),
  production,
  databaseUrl: process.env.DATABASE_URL || "",
  jwtSecret: process.env.JWT_SECRET || (production ? "" : "petcarepick-local-development-secret"),
  accessTokenTtl: process.env.ACCESS_TOKEN_TTL || "15m",
  refreshTokenDays: Number(process.env.REFRESH_TOKEN_DAYS || 30),
  frontendOrigins: (process.env.FRONTEND_ORIGIN || "http://localhost:4173")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
  openAiKey: process.env.OPENAI_API_KEY || "",
  openAiChatModel: process.env.OPENAI_CHAT_MODEL || "gpt-5.4-mini",
  openAiReportModel: process.env.OPENAI_REPORT_MODEL || "gpt-5.5",
  openAiStoreResponses: process.env.OPENAI_STORE_RESPONSES === "true",
  kakaoRestKey: process.env.KAKAO_REST_API_KEY || "",
  mapProvider: process.env.MAP_PROVIDER || "openstreetmap",
};
