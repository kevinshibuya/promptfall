/** Placeholder content: the mechanism is phase 3's, the word list is not. */
export const BLOCKED_WORDS: readonly string[] = ['heck', 'darn', 'frick', 'blockedword']

const blocked = new Set(BLOCKED_WORDS)

/** Whole-word and case-insensitive: any word of the text, split on what is not a letter or digit, in the list. */
export function isBlocked(text: string): boolean {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .some((word) => blocked.has(word))
}
