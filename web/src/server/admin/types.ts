export interface AdminActor {
  userId: string;
  /** Set when authenticated with an agent's admin API key (apikey.id). */
  tokenId?: string;
  permissions: string[];
}
export interface AdminHandlerContext {
  request: Request;
  params: Record<string, string>;
  actor: AdminActor;
}
export class AdminError extends Error {
  constructor(
    message: string,
    public status = 400
  ) {
    super(message);
  }
}
