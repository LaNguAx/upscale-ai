import { Injectable, type NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export const REQUEST_ID_HEADER = 'x-request-id';

export type RequestWithId = Request & { id: string };

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.header(REQUEST_ID_HEADER);
    const id = isSafeRequestId(incoming) ? incoming : randomUUID();
    (req as RequestWithId).id = id;
    res.setHeader(REQUEST_ID_HEADER, id);
    next();
  }
}

const SAFE_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

function isSafeRequestId(value: string | undefined): value is string {
  return typeof value === 'string' && SAFE_ID_PATTERN.test(value);
}
