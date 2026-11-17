import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';

import { envConfigs } from '@/config';

import { authenticateAdmin } from './auth';
import { availableOperations } from './discovery';
import { adminErrorResponse, executeAdmin } from './execute';
import { AdminError } from './types';

export async function handleAdminMcp(request: Request) {
  try {
    // Machine-only endpoint: cookies never authorize MCP calls.
    if (!request.headers.get('authorization'))
      throw new AdminError('Admin bearer token required', 401);
    const origin = request.headers.get('origin');
    if (origin && origin !== new URL(request.url).origin)
      throw new AdminError('Origin not allowed', 403);
    const actor = await authenticateAdmin(request);
    const site = envConfigs.app_name || 'ShipAny';
    const siteUrl = (envConfigs.app_url || new URL(request.url).origin).replace(
      /\/$/,
      ''
    );
    const handler = createMcpHandler(
      () => {
        // Several ShipAny sites can be connected side by side with the same
        // tool names; say which site this server is, so the agent can tell.
        const server = new McpServer(
          { name: 'shipany-admin', title: site, version: '1.0.0' },
          {
            instructions: `Admin API of "${site}" (${siteUrl}). Every tool acts on this site only, with the permissions of the agent account that owns the key. If several ShipAny sites are connected, confirm which site the user means before any write, and never reuse an ID from one site on another.`,
          }
        );
        for (const operation of availableOperations(actor)) {
          server.registerTool(
            operation.name,
            {
              description: operation.description,
              inputSchema: z
                .object({
                  input: operation.schema,
                  idempotencyKey: operation.readOnly
                    ? z.string().optional()
                    : z.string().min(8).max(128),
                })
                .strict(),
              annotations: {
                readOnlyHint: operation.readOnly,
                destructiveHint: !operation.readOnly,
                idempotentHint: true,
                openWorldHint: [
                  'settings_test',
                  'tickets_reply',
                  'orders_refund',
                ].includes(operation.name),
              },
            },
            async ({ input, idempotencyKey }) => {
              let response: Response;
              try {
                response = await executeAdmin(
                  operation,
                  input,
                  actor,
                  idempotencyKey
                );
              } catch (error) {
                response = adminErrorResponse(error);
              }
              const result = await response.json();
              return {
                isError: result.code !== 0,
                content: [
                  { type: 'text' as const, text: JSON.stringify(result) },
                ],
                structuredContent: result,
              };
            }
          );
        }
        return server;
      },
      { maxRequestBodySize: 2_000_000 }
    );
    const response = await handler.fetch(request);
    response.headers.set('Cache-Control', 'no-store');
    return response;
  } catch (error) {
    const response = adminErrorResponse(error);
    if (response.status === 401)
      response.headers.set('WWW-Authenticate', 'Bearer realm="admin"');
    return response;
  }
}
