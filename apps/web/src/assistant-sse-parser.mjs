/**
 * @typedef {object} ParsedAssistantRunEvent
 * @property {number} sequence
 * @property {string} type
 * @property {Record<string, unknown>} payload
 * @property {string} createdAt
 */

/** Parse one persisted server-sent-event block without browser or network state. */
/** @param {string} block @returns {ParsedAssistantRunEvent | null} */
export function parseAssistantSseBlock(block) {
  let id = '';
  let eventName = '';
  const data = [];
  for (const line of block.split(/\r?\n/)) {
    if (!line || line.startsWith(':')) continue;
    const colon = line.indexOf(':');
    const field = colon < 0 ? line : line.slice(0, colon);
    const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
    if (field === 'id') id = value;
    else if (field === 'event') eventName = value;
    else if (field === 'data') data.push(value);
  }
  if (!data.length) return null;
  let parsed;
  try {
    parsed = JSON.parse(data.join('\n'));
  } catch {
    parsed = { payload: { code: 'ASSISTANT_EVENT_INVALID' } };
  }
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const value = /** @type {Record<string, unknown>} */ (parsed);
    const payload = value.payload && typeof value.payload === 'object' && !Array.isArray(value.payload)
      ? /** @type {Record<string, unknown>} */ (value.payload)
      : value;
    const sequenceValue = typeof value.sequence === 'number' ? value.sequence : Number(id || 0);
    const sequence = Number.isSafeInteger(sequenceValue) && sequenceValue >= 0 ? sequenceValue : 0;
    return {
      sequence,
      type: typeof value.type === 'string' ? value.type : eventName || 'stream.message',
      payload,
      createdAt: typeof value.createdAt === 'string' ? value.createdAt : new Date().toISOString(),
    };
  }
  const sequenceValue = Number(id || 0);
  return {
    sequence: Number.isSafeInteger(sequenceValue) && sequenceValue >= 0 ? sequenceValue : 0,
    type: eventName || 'stream.message',
    payload: {},
    createdAt: new Date().toISOString(),
  };
}
