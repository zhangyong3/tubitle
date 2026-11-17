import {
  addMessage,
  getTicketById,
  getTicketMessages,
  getTicketWithUser,
  sanitizeAttachments,
  updateTicketStatus,
  type TicketStatus,
} from '@/modules/tickets/service';
import { respData, respErr, respOk } from '@/lib/resp';

import type { AdminHandlerContext } from '../types';

const VALID_STATUSES: TicketStatus[] = ['open', 'replied', 'closed'];

export async function GET({ request, params, actor }: AdminHandlerContext) {
  try {
    const { id } = params;
    const ticket = await getTicketWithUser(id);
    if (!ticket) return respErr('Ticket not found');
    const messages = await getTicketMessages(id);
    return respData({ ticket, messages });
  } catch (error: any) {
    return respErr(error.message || 'Internal error');
  }
}

// Admin reply — marks the ticket as replied
export async function POST({ request, params, actor }: AdminHandlerContext) {
  try {
    const { id } = params;
    const ticket = await getTicketById(id);
    if (!ticket) return respErr('Ticket not found');

    const body = await request.json().catch(() => ({}));
    const content = typeof body.content === 'string' ? body.content.trim() : '';
    if (!content) return respErr('Content is required');
    if (content.length > 5000) return respErr('Content is too long');

    const attachments = sanitizeAttachments(body.attachments);
    if (attachments === null) return respErr('Invalid attachments');

    const message = await addMessage({
      ticketId: id,
      userId: actor.userId,
      role: 'admin',
      content,
      attachments,
    });
    return respData(message);
  } catch (error: any) {
    return respErr(error.message || 'Internal error');
  }
}

// Admin updates ticket status (close / reopen)
export async function PATCH({ request, params, actor }: AdminHandlerContext) {
  try {
    const { id } = params;
    const ticket = await getTicketById(id);
    if (!ticket) return respErr('Ticket not found');

    const body = await request.json().catch(() => ({}));
    const status = body.status as TicketStatus;
    if (!VALID_STATUSES.includes(status)) return respErr('Invalid status');

    await updateTicketStatus(id, status);
    return respOk();
  } catch (error: any) {
    return respErr(error.message || 'Internal error');
  }
}
