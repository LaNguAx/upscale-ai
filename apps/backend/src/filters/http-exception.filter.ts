import { Catch, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ZodSerializationException, ZodValidationException } from 'nestjs-zod';
import { ZodError } from 'zod';
import type { ProblemDetails } from '@repo/schemas/errors';
import type { Request, Response } from 'express';
import {
  GENERIC_500_DETAIL,
  GENERIC_500_TITLE,
  VALIDATION_FAILED_DEV_DETAIL,
  VALIDATION_FAILED_PROD_DETAIL,
  VALIDATION_FAILED_TITLE,
  ZOD_SERIALIZATION_DEV_DETAIL
} from '@/consts/errors.consts';
import {
  PROBLEM_TYPE_HTTP_ERROR,
  PROBLEM_TYPE_INTERNAL_ERROR,
  PROBLEM_TYPE_VALIDATION_FAILED
} from '@/consts/problem-types.consts';
import {
  DEFAULT_STATUS_TITLE,
  STATUS_TITLES
} from '@/consts/status-titles.consts';
import type { Env } from '@/utils/env.validation';
import type { RequestWithId } from '@/middleware/request-id.middleware';

const SAFE_STRINGIFY_MAX_LENGTH = 2048;

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);
  private readonly isProduction: boolean;

  constructor(configService: ConfigService<Env, true>) {
    this.isProduction =
      configService.get('NODE_ENV', { infer: true }) === 'production';
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const instance = getInstance(request);
    const traceId = (request as Partial<RequestWithId>).id;

    const problem = this.toProblem(exception, instance, traceId);
    this.logException(exception, problem, request.method);

    if (response.headersSent) {
      response.end();
      return;
    }

    response.status(problem.status).json(problem);
  }

  private toProblem(
    exception: unknown,
    instance: string,
    traceId: string | undefined
  ): ProblemDetails {
    if (exception instanceof ZodValidationException) {
      const problem: ProblemDetails = {
        type: PROBLEM_TYPE_VALIDATION_FAILED,
        title: VALIDATION_FAILED_TITLE,
        status: HttpStatus.BAD_REQUEST,
        instance
      };
      if (this.isProduction) {
        problem.detail = VALIDATION_FAILED_PROD_DETAIL;
      } else {
        const zodError = exception.getZodError();
        const issues = zodError instanceof ZodError ? zodError.issues : [];
        problem.detail = VALIDATION_FAILED_DEV_DETAIL;
        problem.errors = issues;
      }
      return withTraceId(problem, traceId);
    }

    if (exception instanceof ZodSerializationException) {
      return this.unexpectedProblem(instance, exception, traceId);
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const { title, detail, errors } = normalizeHttpResponse(body, status);
      const safeTitle =
        status >= 500 && this.isProduction
          ? (STATUS_TITLES.get(status) ?? DEFAULT_STATUS_TITLE)
          : title;
      const problem: ProblemDetails = {
        type: PROBLEM_TYPE_HTTP_ERROR,
        title: safeTitle,
        status,
        instance
      };
      if (status >= 500) {
        problem.detail = this.isProduction ? GENERIC_500_DETAIL : detail;
      } else if (detail !== undefined) {
        problem.detail = detail;
      }
      if (!this.isProduction && errors !== undefined) {
        problem.errors = errors;
      }
      return withTraceId(problem, traceId);
    }

    return this.unexpectedProblem(instance, exception, traceId);
  }

  private unexpectedProblem(
    instance: string,
    exception: unknown,
    traceId: string | undefined
  ): ProblemDetails {
    const problem: ProblemDetails = {
      type: PROBLEM_TYPE_INTERNAL_ERROR,
      title: GENERIC_500_TITLE,
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      instance
    };
    if (this.isProduction) {
      problem.detail = GENERIC_500_DETAIL;
    } else if (exception instanceof ZodSerializationException) {
      problem.detail = ZOD_SERIALIZATION_DEV_DETAIL;
    } else if (exception instanceof Error) {
      problem.detail = exception.message;
    } else {
      problem.detail = safeStringify(exception);
    }
    return withTraceId(problem, traceId);
  }

  private logException(
    exception: unknown,
    problem: ProblemDetails,
    method: string
  ): void {
    const traceSuffix = problem.traceId ? ` [trace=${problem.traceId}]` : '';
    const prefix = `[${String(problem.status)}] ${method} ${problem.instance}${traceSuffix}`;
    const stack = exception instanceof Error ? exception.stack : undefined;

    if (exception instanceof ZodValidationException) {
      const zodError = exception.getZodError();
      const issues = zodError instanceof ZodError ? zodError.issues : [];
      const issueCount = issues.length;
      const issuesPart =
        issueCount > 0 ? ` — issues=${safeStringify(issues)}` : '';

      this.logger.warn(
        `${prefix} — ${problem.title} (${String(issueCount)} issue${issueCount === 1 ? '' : 's'})${issuesPart}`
      );
      return;
    }

    if (exception instanceof ZodSerializationException) {
      const zodError = exception.getZodError();
      const issues =
        zodError instanceof ZodError
          ? zodError.message
          : safeStringify(exception);
      this.logger.error(
        `${prefix} — ZodSerializationException: ${issues}`,
        stack
      );
      return;
    }

    if (exception instanceof HttpException) {
      const rawBody = exception.getResponse();
      const { detail, errors } = normalizeHttpResponse(rawBody, problem.status);
      const detailPart = detail ? ` — ${detail}` : '';
      const errorsPart =
        Array.isArray(errors) && errors.length > 0
          ? ` — errors=${safeStringify(errors)}`
          : '';

      const line = `${prefix} — ${problem.title}${detailPart}${errorsPart}`;

      if (problem.status >= 500) {
        this.logger.error(line, stack);
      } else {
        this.logger.warn(line);
      }
      return;
    }

    const message =
      exception instanceof Error ? exception.message : safeStringify(exception);
    this.logger.error(`${prefix} — Unhandled exception: ${message}`, stack);
  }
}

function getInstance(request: Request): string {
  const raw = request.originalUrl || request.url || '';
  const queryStart = raw.indexOf('?');
  return queryStart === -1 ? raw : raw.slice(0, queryStart);
}

function withTraceId(
  problem: ProblemDetails,
  traceId: string | undefined
): ProblemDetails {
  if (traceId !== undefined) {
    problem.traceId = traceId;
  }
  return problem;
}

function safeStringify(value: unknown): string {
  const raw = rawStringify(value);
  return raw.length > SAFE_STRINGIFY_MAX_LENGTH
    ? `${raw.slice(0, SAFE_STRINGIFY_MAX_LENGTH)}…[truncated]`
    : raw;
}

function rawStringify(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return String(value);
  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    return String(value);
  }
  if (typeof value === 'symbol') return value.toString();
  if (typeof value === 'function') return '[function]';
  try {
    const json = JSON.stringify(value);
    return typeof json === 'string' ? json : '[unserializable]';
  } catch {
    return '[unserializable]';
  }
}

type NormalizedHttpResponse = {
  title: string;
  detail?: string;
  errors?: unknown[];
};

function normalizeHttpResponse(
  raw: string | object,
  status: number
): NormalizedHttpResponse {
  const fallbackTitle = STATUS_TITLES.get(status) ?? DEFAULT_STATUS_TITLE;
  if (typeof raw === 'string') {
    return { title: fallbackTitle, detail: raw };
  }
  const obj = raw as Record<string, unknown>;
  const title = typeof obj['error'] === 'string' ? obj['error'] : fallbackTitle;
  const message = obj['message'];
  const result: NormalizedHttpResponse = { title };
  if (typeof message === 'string') {
    result.detail = message;
  } else if (Array.isArray(message)) {
    result.detail = message.join('; ');
    result.errors = message as unknown[];
  }
  return result;
}
