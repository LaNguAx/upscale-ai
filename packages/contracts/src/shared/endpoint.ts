import type { z } from 'zod';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type EndpointContract<
  TResponse = unknown,
  TBody = void,
  TParams = void,
  TQuery = void
> = {
  method: HttpMethod;
  path: string;
  responseSchema: z.ZodType<TResponse>;
} & ([TBody] extends [void] ? object : { bodySchema: z.ZodType<TBody> }) &
  ([TParams] extends [void] ? object : { paramsSchema: z.ZodType<TParams> }) &
  ([TQuery] extends [void] ? object : { querySchema: z.ZodType<TQuery> });

export type ContractResponse<C> =
  C extends EndpointContract<infer R, unknown, unknown, unknown> ? R : never;

export type ContractBody<C> =
  C extends EndpointContract<unknown, infer B, unknown, unknown> ? B : never;

export type ContractParams<C> =
  C extends EndpointContract<unknown, unknown, infer P, unknown> ? P : never;

export type ContractQuery<C> =
  C extends EndpointContract<unknown, unknown, unknown, infer Q> ? Q : never;

export type ContractInput<TBody, TParams, TQuery> = ([TBody] extends [void]
  ? object
  : { body: TBody }) &
  ([TParams] extends [void] ? object : { params: TParams }) &
  ([TQuery] extends [void] ? object : { query: TQuery });

export type HasInput<TBody, TParams, TQuery> = [
  TBody,
  TParams,
  TQuery
] extends [void, void, void]
  ? false
  : true;
