import { z } from 'zod';

import {
  adminOperations,
  envelopeSchema,
  operationDescriptor,
} from '@/lib/admin-operations';

import { canOperate } from './auth';
import type { AdminActor } from './types';

export function availableOperations(actor: AdminActor) {
  return adminOperations.filter((operation) =>
    canOperate(actor, operation.permission)
  );
}
export function operationCatalog(actor: AdminActor) {
  return availableOperations(actor).map(operationDescriptor);
}
export function adminOpenApi(actor: AdminActor) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const operation of availableOperations(actor)) {
    const schema = z.toJSONSchema(operation.schema, { io: 'input' });
    const { $schema: _, ...input } = schema;
    const pathKeys = [...operation.path.matchAll(/\{(\w+)\}/g)].map(
      (match) => match[1]
    );
    const properties = (input.properties || {}) as Record<string, unknown>;
    const required = (input.required || []) as string[];
    const parameters: unknown[] = pathKeys.map((key) => ({
      in: 'path',
      name: key,
      required: true,
      schema: properties[key],
    }));
    if (['GET', 'DELETE'].includes(operation.method)) {
      for (const [name, value] of Object.entries(properties))
        if (!pathKeys.includes(name))
          parameters.push({
            in: 'query',
            name,
            required: required.includes(name),
            schema: value,
          });
    }
    if (!operation.readOnly)
      parameters.push({
        in: 'header',
        name: 'Idempotency-Key',
        required: true,
        schema: { type: 'string', minLength: 8, maxLength: 128 },
        description:
          'Required for token-authenticated writes. Reuse with exactly the same input on retries.',
      });
    const bodyProperties = Object.fromEntries(
      Object.entries(properties).filter(([key]) => !pathKeys.includes(key))
    );
    const bodySchema = {
      ...input,
      ...(input.properties
        ? {
            properties: bodyProperties,
            required: required.filter((key) => !pathKeys.includes(key)),
          }
        : {}),
    };
    paths[operation.path] ||= {};
    paths[operation.path][operation.method.toLowerCase()] = {
      operationId: operation.name,
      summary: operation.description,
      'x-required-permission': operation.permission,
      parameters,
      ...(['GET', 'DELETE'].includes(operation.method)
        ? {}
        : {
            requestBody: {
              required: true,
              content: { 'application/json': { schema: bodySchema } },
            },
          }),
      responses: Object.fromEntries(
        [200, 400, 401, 403, 409, 500].map((code) => [
          code,
          {
            description: code === 200 ? 'Success' : 'Error',
            content: { 'application/json': { schema: envelopeSchema } },
          },
        ])
      ),
    };
  }
  return {
    openapi: '3.1.0',
    info: { title: 'Admin API', version: '1.0.0' },
    security: [{ adminToken: [] }],
    components: {
      securitySchemes: {
        adminToken: {
          type: 'http',
          scheme: 'bearer',
          description:
            'Agent admin API key (sa_admin_…). Permissions are the agent account’s RBAC roles.',
        },
      },
    },
    paths,
  };
}
