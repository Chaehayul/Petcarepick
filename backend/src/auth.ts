import { createHash, randomBytes } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { config } from "./config.js";
import { AppError } from "./errors.js";

export type AuthUser = {
  id: string;
  email: string;
};

declare global {
  namespace Express {
    interface Request {
      id: string;
      user?: AuthUser;
    }
  }
}

function requireJwtSecret() {
  if (!config.jwtSecret) {
    throw new AppError(503, "JWT_SECRET 환경변수가 필요해요.", "AUTH_NOT_CONFIGURED");
  }
  return config.jwtSecret;
}

export function createAccessToken(user: AuthUser) {
  return jwt.sign(
    { email: user.email },
    requireJwtSecret(),
    { subject: user.id, expiresIn: config.accessTokenTtl as jwt.SignOptions["expiresIn"] },
  );
}

export function createRefreshToken() {
  return randomBytes(48).toString("base64url");
}

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function verifyAccessToken(token: string): AuthUser {
  try {
    const payload = jwt.verify(token, requireJwtSecret());
    if (typeof payload === "string" || !payload.sub || typeof payload.email !== "string") {
      throw new Error("Invalid token payload");
    }
    return { id: payload.sub, email: payload.email };
  } catch {
    throw new AppError(401, "로그인이 필요하거나 토큰이 만료되었어요.", "UNAUTHORIZED");
  }
}

export function requireAuth(request: Request, _response: Response, next: NextFunction) {
  const token = request.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
  if (!token) return next(new AppError(401, "로그인이 필요해요.", "UNAUTHORIZED"));
  try {
    request.user = verifyAccessToken(token);
    next();
  } catch (error) {
    next(error);
  }
}

export function optionalAuth(request: Request, _response: Response, next: NextFunction) {
  const token = request.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
  if (!token) return next();
  try {
    request.user = verifyAccessToken(token);
  } catch {
    request.user = undefined;
  }
  next();
}
