// A thrown thing is not always an Error, and every layer here reports why it stopped.
/**
 * @param {unknown} error
 * @returns {string}
 */
export function reason(error) {
  if (error instanceof Error) return error.message;
  return String(error);
}
