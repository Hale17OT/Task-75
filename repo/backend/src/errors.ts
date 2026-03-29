import type { AppErrorShape } from "./types.js";

export class AppError extends Error implements AppErrorShape {
  statusCode: number;

  code: string;

  details?: Record<string, unknown>;

  constructor(statusCode: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export const isAppError = (error: unknown): error is AppError => error instanceof AppError;

