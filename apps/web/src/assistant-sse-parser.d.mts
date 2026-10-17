export type ParsedAssistantRunEvent = {
  sequence: number;
  type: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

export declare function parseAssistantSseBlock(block: string): ParsedAssistantRunEvent | null;
