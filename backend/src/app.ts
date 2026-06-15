import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { config } from "./config.js";
import { createAccessToken, createRefreshToken, hashToken, optionalAuth, requireAuth } from "./auth.js";
import { databaseEnabled, getDb } from "./db.js";
import { AppError, errorHandler, notFoundHandler } from "./errors.js";
import { createHealthChat, createHealthReport, findNearbyHospitals } from "./external.js";
import {
  chatSchema,
  eventPatchSchema,
  eventSchema,
  feedbackSchema,
  loginSchema,
  petPatchSchema,
  petSchema,
  recordPatchSchema,
  recordSchema,
  refreshSchema,
  reportSchema,
  signupSchema,
  userPatchSchema,
} from "./validation.js";

const DAY_MS = 24 * 60 * 60 * 1000;

function requireDatabase() {
  const db = getDb();
  if (!db) throw new AppError(503, "DATABASE_URL이 설정되지 않아 데이터 API를 사용할 수 없어요.", "DATABASE_NOT_CONFIGURED");
  return db;
}

function dateOnly(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function routeParam(request: Request, name: string) {
  const value = request.params[name];
  if (typeof value !== "string") {
    throw new AppError(400, `경로 파라미터 ${name}이 올바르지 않아요.`, "INVALID_PATH_PARAMETER");
  }
  return value;
}

function normalizePetInput<T extends { reminders?: Record<string, boolean> | null }>(input: T) {
  return {
    ...input,
    reminders: input.reminders === null ? undefined : input.reminders,
  };
}

function serializeDate<T extends Record<string, any>>(item: T) {
  return {
    ...item,
    ...(item.date instanceof Date ? { date: item.date.toISOString().slice(0, 10) } : {}),
  };
}

async function ownedPet(userId: string, petId: string) {
  const pet = await requireDatabase().pet.findFirst({ where: { id: petId, userId } });
  if (!pet) throw new AppError(404, "반려동물을 찾을 수 없어요.", "PET_NOT_FOUND");
  return pet;
}

async function issueTokens(user: { id: string; email: string }) {
  const db = requireDatabase();
  const refreshToken = createRefreshToken();
  await db.refreshToken.create({
    data: {
      tokenHash: hashToken(refreshToken),
      userId: user.id,
      expiresAt: new Date(Date.now() + config.refreshTokenDays * DAY_MS),
    },
  });
  return {
    accessToken: createAccessToken(user),
    refreshToken,
    expiresIn: config.accessTokenTtl,
  };
}

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);

  app.use((request: Request, response: Response, next: NextFunction) => {
    request.id = request.headers["x-request-id"]?.toString() || randomUUID();
    response.setHeader("X-Request-Id", request.id);
    const startedAt = performance.now();
    response.on("finish", () => {
      console.log(JSON.stringify({
        requestId: request.id,
        method: request.method,
        path: request.path,
        status: response.statusCode,
        durationMs: Math.round(performance.now() - startedAt),
      }));
    });
    next();
  });

  app.use(helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
  }));
  app.use(cors({
    origin(origin, callback) {
      if (!origin || config.frontendOrigins.includes(origin)) return callback(null, true);
      callback(new AppError(403, "허용되지 않은 출처예요.", "CORS_DENIED"));
    },
    allowedHeaders: ["Content-Type", "Authorization", "X-Request-Id"],
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  }));
  app.use(express.json({ limit: "1mb" }));
  app.use(rateLimit({
    windowMs: 60_000,
    limit: 120,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  }));

  app.get("/api/health", async (_request, response) => {
    let database = false;
    if (databaseEnabled()) {
      try {
        const db = getDb();
        if (db) await db.$queryRaw`SELECT 1`;
        database = true;
      } catch {
        database = false;
      }
    }
    response.json({
      ok: true,
      service: "petcarepick-backend",
      version: "1.0.0",
      capabilities: {
        database,
        auth: database && Boolean(config.jwtSecret),
        ai: Boolean(config.openAiKey),
        hospitals: "openstreetmap",
        kakaoFallback: Boolean(config.kakaoRestKey),
      },
    });
  });

  const authLimiter = rateLimit({
    windowMs: 15 * 60_000,
    limit: 20,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  });

  app.post("/api/auth/signup", authLimiter, async (request, response) => {
    const input = signupSchema.parse(request.body);
    const db = requireDatabase();
    const existing = await db.user.findUnique({ where: { email: input.email } });
    if (existing) throw new AppError(409, "이미 가입된 이메일이에요.", "EMAIL_ALREADY_EXISTS");

    const user = await db.user.create({
      data: {
        name: input.name,
        email: input.email,
        passwordHash: await bcrypt.hash(input.password, 12),
      },
      select: { id: true, name: true, email: true, createdAt: true },
    });
    response.status(201).json({ user, tokens: await issueTokens(user) });
  });

  app.post("/api/auth/login", authLimiter, async (request, response) => {
    const input = loginSchema.parse(request.body);
    const db = requireDatabase();
    const user = await db.user.findUnique({ where: { email: input.email } });
    if (!user || !(await bcrypt.compare(input.password, user.passwordHash))) {
      throw new AppError(401, "이메일 또는 비밀번호가 올바르지 않아요.", "INVALID_CREDENTIALS");
    }
    response.json({
      user: { id: user.id, name: user.name, email: user.email, createdAt: user.createdAt },
      tokens: await issueTokens(user),
    });
  });

  app.post("/api/auth/refresh", authLimiter, async (request, response) => {
    const { refreshToken } = refreshSchema.parse(request.body);
    const db = requireDatabase();
    const stored = await db.refreshToken.findUnique({
      where: { tokenHash: hashToken(refreshToken) },
      include: { user: true },
    });
    if (!stored || stored.revokedAt || stored.expiresAt <= new Date()) {
      throw new AppError(401, "Refresh Token이 만료되었거나 유효하지 않아요.", "INVALID_REFRESH_TOKEN");
    }

    const nextRefresh = createRefreshToken();
    await db.$transaction([
      db.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date() } }),
      db.refreshToken.create({
        data: {
          tokenHash: hashToken(nextRefresh),
          userId: stored.userId,
          expiresAt: new Date(Date.now() + config.refreshTokenDays * DAY_MS),
        },
      }),
    ]);
    response.json({
      accessToken: createAccessToken(stored.user),
      refreshToken: nextRefresh,
      expiresIn: config.accessTokenTtl,
    });
  });

  app.post("/api/auth/logout", async (request, response) => {
    const { refreshToken } = refreshSchema.parse(request.body);
    const db = requireDatabase();
    await db.refreshToken.updateMany({
      where: { tokenHash: hashToken(refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
    response.status(204).end();
  });

  app.get("/api/users/me", requireAuth, async (request, response) => {
    const user = await requireDatabase().user.findUnique({
      where: { id: request.user!.id },
      select: { id: true, name: true, email: true, createdAt: true, updatedAt: true },
    });
    if (!user) throw new AppError(404, "사용자를 찾을 수 없어요.", "USER_NOT_FOUND");
    response.json({ user });
  });

  app.patch("/api/users/me", requireAuth, async (request, response) => {
    const input = userPatchSchema.parse(request.body);
    const user = await requireDatabase().user.update({
      where: { id: request.user!.id },
      data: input,
      select: { id: true, name: true, email: true, createdAt: true, updatedAt: true },
    });
    response.json({ user });
  });

  app.delete("/api/users/me", requireAuth, async (request, response) => {
    await requireDatabase().user.delete({ where: { id: request.user!.id } });
    response.status(204).end();
  });

  app.get("/api/pets", requireAuth, async (request, response) => {
    const pets = await requireDatabase().pet.findMany({
      where: { userId: request.user!.id },
      orderBy: { createdAt: "asc" },
    });
    response.json({ pets });
  });

  app.post("/api/pets", requireAuth, async (request, response) => {
    const input = petSchema.parse(request.body);
    const pet = await requireDatabase().pet.create({
      data: { ...normalizePetInput(input), userId: request.user!.id },
    });
    response.status(201).json({ pet });
  });

  app.get("/api/pets/:petId", requireAuth, async (request, response) => {
    response.json({ pet: await ownedPet(request.user!.id, routeParam(request, "petId")) });
  });

  app.patch("/api/pets/:petId", requireAuth, async (request, response) => {
    await ownedPet(request.user!.id, routeParam(request, "petId"));
    const pet = await requireDatabase().pet.update({
      where: { id: routeParam(request, "petId") },
      data: normalizePetInput(petPatchSchema.parse(request.body)),
    });
    response.json({ pet });
  });

  app.delete("/api/pets/:petId", requireAuth, async (request, response) => {
    await ownedPet(request.user!.id, routeParam(request, "petId"));
    await requireDatabase().pet.delete({ where: { id: routeParam(request, "petId") } });
    response.status(204).end();
  });

  app.get("/api/pets/:petId/records", requireAuth, async (request, response) => {
    await ownedPet(request.user!.id, routeParam(request, "petId"));
    const from = typeof request.query.from === "string" ? dateOnly(request.query.from) : undefined;
    const to = typeof request.query.to === "string" ? dateOnly(request.query.to) : undefined;
    const records = await requireDatabase().healthRecord.findMany({
      where: {
        petId: routeParam(request, "petId"),
        ...(from || to ? { date: { gte: from, lte: to } } : {}),
      },
      orderBy: [{ date: "desc" }, { updatedAt: "desc" }],
    });
    response.json({ records: records.map(serializeDate) });
  });

  app.post("/api/pets/:petId/records", requireAuth, async (request, response) => {
    await ownedPet(request.user!.id, routeParam(request, "petId"));
    const input = recordSchema.parse(request.body);
    const date = dateOnly(input.date);
    const record = await requireDatabase().healthRecord.upsert({
      where: {
        petId_date_category: {
          petId: routeParam(request, "petId"),
          date,
          category: input.category,
        },
      },
      create: { ...input, date, petId: routeParam(request, "petId") },
      update: { value: input.value, detail: input.detail },
    });
    response.status(201).json({ record: serializeDate(record) });
  });

  app.patch("/api/records/:recordId", requireAuth, async (request, response) => {
    const db = requireDatabase();
    const existing = await db.healthRecord.findFirst({
      where: { id: routeParam(request, "recordId"), pet: { userId: request.user!.id } },
    });
    if (!existing) throw new AppError(404, "건강 기록을 찾을 수 없어요.", "RECORD_NOT_FOUND");
    const input = recordPatchSchema.parse(request.body);
    const record = await db.healthRecord.update({
      where: { id: existing.id },
      data: { ...input, ...(input.date ? { date: dateOnly(input.date) } : {}) },
    });
    response.json({ record: serializeDate(record) });
  });

  app.delete("/api/records/:recordId", requireAuth, async (request, response) => {
    const result = await requireDatabase().healthRecord.deleteMany({
      where: { id: routeParam(request, "recordId"), pet: { userId: request.user!.id } },
    });
    if (!result.count) throw new AppError(404, "건강 기록을 찾을 수 없어요.", "RECORD_NOT_FOUND");
    response.status(204).end();
  });

  app.get("/api/pets/:petId/events", requireAuth, async (request, response) => {
    await ownedPet(request.user!.id, routeParam(request, "petId"));
    const events = await requireDatabase().healthEvent.findMany({
      where: { petId: routeParam(request, "petId") },
      orderBy: [{ date: "asc" }, { time: "asc" }],
    });
    response.json({ events: events.map(serializeDate) });
  });

  app.post("/api/pets/:petId/events", requireAuth, async (request, response) => {
    await ownedPet(request.user!.id, routeParam(request, "petId"));
    const input = eventSchema.parse(request.body);
    const event = await requireDatabase().healthEvent.create({
      data: { ...input, date: dateOnly(input.date), petId: routeParam(request, "petId") },
    });
    response.status(201).json({ event: serializeDate(event) });
  });

  app.patch("/api/events/:eventId", requireAuth, async (request, response) => {
    const db = requireDatabase();
    const existing = await db.healthEvent.findFirst({
      where: { id: routeParam(request, "eventId"), pet: { userId: request.user!.id } },
    });
    if (!existing) throw new AppError(404, "일정을 찾을 수 없어요.", "EVENT_NOT_FOUND");
    const input = eventPatchSchema.parse(request.body);
    const event = await db.healthEvent.update({
      where: { id: existing.id },
      data: { ...input, ...(input.date ? { date: dateOnly(input.date) } : {}) },
    });
    response.json({ event: serializeDate(event) });
  });

  app.delete("/api/events/:eventId", requireAuth, async (request, response) => {
    const result = await requireDatabase().healthEvent.deleteMany({
      where: { id: routeParam(request, "eventId"), pet: { userId: request.user!.id } },
    });
    if (!result.count) throw new AppError(404, "일정을 찾을 수 없어요.", "EVENT_NOT_FOUND");
    response.status(204).end();
  });

  app.post("/api/pets/:petId/feedback", requireAuth, async (request, response) => {
    await ownedPet(request.user!.id, routeParam(request, "petId"));
    const feedback = await requireDatabase().recommendationFeedback.create({
      data: { ...feedbackSchema.parse(request.body), petId: routeParam(request, "petId") },
    });
    response.status(201).json({ feedback });
  });

  app.get("/api/pets/:petId/feedback", requireAuth, async (request, response) => {
    await ownedPet(request.user!.id, routeParam(request, "petId"));
    const feedback = await requireDatabase().recommendationFeedback.findMany({
      where: { petId: routeParam(request, "petId") },
      orderBy: { createdAt: "asc" },
      take: 500,
    });
    response.json({ feedback });
  });

  app.get("/api/chat/sessions", requireAuth, async (request, response) => {
    const sessions = await requireDatabase().chatSession.findMany({
      where: { userId: request.user!.id },
      include: { messages: { orderBy: { createdAt: "asc" }, take: 50 } },
      orderBy: { updatedAt: "desc" },
      take: 30,
    });
    response.json({ sessions });
  });

  app.post("/api/hospitals/nearby", async (request, response) => {
    response.json(await findNearbyHospitals(request.body));
  });

  app.post("/api/ai/chat", optionalAuth, async (request, response) => {
    const input = chatSchema.parse(request.body);
    const result = await createHealthChat(input);
    let sessionId = input.sessionId;

    if (request.user && databaseEnabled()) {
      const db = requireDatabase();
      if (input.pet.id) await ownedPet(request.user.id, input.pet.id);
      let session = sessionId
        ? await db.chatSession.findFirst({ where: { id: sessionId, userId: request.user.id } })
        : null;
      if (!session) {
        session = await db.chatSession.create({
          data: {
            userId: request.user.id,
            petId: input.pet.id || null,
            title: input.message.slice(0, 40),
          },
        });
      }
      sessionId = session.id;
      await db.chatMessage.createMany({
        data: [
          { sessionId, role: "user", content: input.message },
          { sessionId, role: "assistant", content: result.message, source: result.source },
        ],
      });
      await db.chatSession.update({ where: { id: sessionId }, data: { updatedAt: new Date() } });
    }
    response.json({ ...result, sessionId });
  });

  app.get("/api/pets/:petId/reports", requireAuth, async (request, response) => {
    const petId = routeParam(request, "petId");
    await ownedPet(request.user!.id, petId);
    const reports = await requireDatabase().healthReport.findMany({
      where: { petId, userId: request.user!.id },
      orderBy: { createdAt: "desc" },
      take: 12,
    });
    response.json({ reports });
  });

  app.post("/api/reports/health", optionalAuth, async (request, response) => {
    const input = reportSchema.parse(request.body);
    const result = await createHealthReport(input);
    let savedReport = null;
    if (request.user && databaseEnabled()) {
      await ownedPet(request.user.id, input.pet.id);
      savedReport = await requireDatabase().healthReport.create({
        data: {
          userId: request.user.id,
          petId: input.pet.id,
          report: result.report,
          source: result.source,
        },
      });
    }
    response.json({ ...result, savedReportId: savedReport?.id });
  });

  app.get("/api/openapi.json", (_request, response) => {
    response.json({
      openapi: "3.1.0",
      info: { title: "Petcarepick API", version: "1.0.0" },
      servers: [{ url: "/api" }],
      paths: {
        "/health": { get: { summary: "서비스 상태 확인" } },
        "/auth/signup": { post: { summary: "회원가입" } },
        "/auth/login": { post: { summary: "로그인" } },
        "/pets": { get: { summary: "반려동물 목록" }, post: { summary: "반려동물 등록" } },
        "/pets/{petId}/records": { get: { summary: "건강 기록 목록" }, post: { summary: "건강 기록 저장" } },
        "/pets/{petId}/events": { get: { summary: "일정 목록" }, post: { summary: "일정 등록" } },
        "/ai/chat": { post: { summary: "AI 헬스 상담" } },
        "/hospitals/nearby": { post: { summary: "위치 기반 동물병원 검색" } },
      },
    });
  });

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
