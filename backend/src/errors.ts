import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";

export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code = "APP_ERROR",
    public details?: unknown,
  ) {
    super(message);
  }
}

export function notFoundHandler(request: Request, _response: Response, next: NextFunction) {
  next(new AppError(404, `${request.method} ${request.path} 경로를 찾을 수 없어요.`, "NOT_FOUND"));
}

export function errorHandler(error: unknown, request: Request, response: Response, _next: NextFunction) {
  if (error instanceof ZodError) {
    return response.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "입력값을 확인해주세요.",
        details: error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
        requestId: request.id,
      },
    });
  }

  const appError = error instanceof AppError
    ? error
    : new AppError(500, "서버에서 오류가 발생했어요.", "INTERNAL_ERROR");

  if (appError.statusCode >= 500) console.error(`[${request.id}]`, error);
  return response.status(appError.statusCode).json({
    error: {
      code: appError.code,
      message: appError.message,
      details: appError.details,
      requestId: request.id,
    },
  });
}
