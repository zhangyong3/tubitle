import { fromJsonSchema, McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';

import {
  adminConnection,
  adminRequest,
} from '../.claude/skills/shipany-admin/scripts/admin-client.mjs';

// No env-file loader or stdout logging here: stdout belongs to MCP exclusively.
const connection = adminConnection();
serveStdio(
  async () => {
    const catalog = await adminRequest(
      '/api/admin/agent/operations',
      undefined,
      connection
    );
    if (catalog.status !== 200 || catalog.result.code !== 0)
      throw new Error('Cannot discover admin operations; check credentials.');
    const server = new McpServer({ name: 'shipany-admin', version: '1.0.0' });
    for (const operation of catalog.result.data) {
      server.registerTool(
        operation.name,
        {
          description: operation.description,
          inputSchema: fromJsonSchema<{
            input: Record<string, unknown>;
            idempotencyKey?: string;
          }>({
            type: 'object',
            additionalProperties: false,
            properties: {
              input: operation.inputSchema,
              idempotencyKey: { type: 'string', minLength: 8, maxLength: 128 },
            },
            required: operation.readOnly
              ? ['input']
              : ['input', 'idempotencyKey'],
          }),
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
          try {
            const { result } = await adminRequest(
              '/api/admin/agent/execute',
              { operation: operation.name, input, idempotencyKey },
              connection
            );
            return {
              isError: result.code !== 0,
              content: [
                { type: 'text' as const, text: JSON.stringify(result) },
              ],
              structuredContent: result,
            };
          } catch {
            return {
              isError: true,
              content: [
                {
                  type: 'text' as const,
                  text: 'Connection failed. For a write, retry only with the same input and idempotencyKey; the operation may already have completed.',
                },
              ],
            };
          }
        }
      );
    }
    return server;
  },
  {
    onerror: () =>
      console.error(
        'MCP request failed; check the server connection and credential permissions.'
      ),
  }
);
