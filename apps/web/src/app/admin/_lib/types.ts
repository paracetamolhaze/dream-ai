/** State returned by admin server actions to <ActionForm>. Shared by server and client code (type-only). */
export type ActionState = {
  ok: boolean;
  message: string;
  /** Timestamp — makes consecutive identical results distinguishable. */
  at: number;
  data?: Record<string, string>;
} | null;

export type AdminAction = (prev: ActionState, formData: FormData) => Promise<ActionState>;
