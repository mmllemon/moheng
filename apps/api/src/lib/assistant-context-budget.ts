export const ASSISTANT_CONTEXT_CHARACTER_BUDGET = 24_000;

export type AssistantContextMessage = {
  role: 'user' | 'assistant';
  content: string;
};

export type BoundedAssistantHistory = {
  messages: AssistantContextMessage[];
  truncated: boolean;
  omittedPriorMessageCount: number;
  totalCharacters: number;
};

/**
 * Keep the newest contiguous prior messages that fit together with the current prompt.
 * JavaScript UTF-16 code units provide a provider-independent size ceiling; this is not a token count.
 */
export function buildAssistantHistoryWithinBudget(
  priorMessages: readonly AssistantContextMessage[],
  currentPrompt: string,
  maxCharacters = ASSISTANT_CONTEXT_CHARACTER_BUDGET,
): BoundedAssistantHistory {
  if (!Number.isSafeInteger(maxCharacters) || maxCharacters < 1) {
    throw new Error('ASSISTANT_CONTEXT_BUDGET_INVALID');
  }
  if (currentPrompt.length > maxCharacters) {
    throw new Error('ASSISTANT_PROMPT_EXCEEDS_CONTEXT_BUDGET');
  }

  let remaining = maxCharacters - currentPrompt.length;
  const selected: AssistantContextMessage[] = [];
  for (let index = priorMessages.length - 1; index >= 0; index -= 1) {
    const message = priorMessages[index]!;
    if (message.role !== 'user' && message.role !== 'assistant') {
      throw new Error('ASSISTANT_CONTEXT_ROLE_INVALID');
    }
    if (typeof message.content !== 'string') {
      throw new Error('ASSISTANT_CONTEXT_MESSAGE_INVALID');
    }
    if (message.content.length > remaining) break;
    selected.unshift({ role: message.role, content: message.content });
    remaining -= message.content.length;
  }

  const messages: AssistantContextMessage[] = [
    ...selected,
    { role: 'user', content: currentPrompt },
  ];
  return {
    messages,
    truncated: selected.length < priorMessages.length,
    omittedPriorMessageCount: priorMessages.length - selected.length,
    totalCharacters: maxCharacters - remaining,
  };
}
