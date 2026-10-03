/** 1240 -> "1,240", without Intl. */
export function formatGold(n: number): string {
  const sign = n < 0 ? '-' : ''
  const digits = String(Math.abs(Math.trunc(n)))
  let out = ''
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ','
    out += digits[i]
  }
  return `${sign}${out}g`
}

/** Cuts to `width` cells with an ellipsis; never wraps. */
export function clip(text: string, width: number): string {
  if (width <= 0) return ''
  const chars = [...text]
  if (chars.length <= width) return text
  if (width === 1) return '…'
  return `${chars.slice(0, width - 1).join('')}…`
}

export function padEnd(text: string, width: number): string {
  const fitted = clip(text, width)
  return fitted + ' '.repeat(Math.max(0, width - [...fitted].length))
}

export function padStart(text: string, width: number): string {
  const fitted = clip(text, width)
  return ' '.repeat(Math.max(0, width - [...fitted].length)) + fitted
}

export const CLASS_LABEL: Record<string, string> = {
  knight: 'Knight',
  black_mage: 'BMage',
  white_mage: 'WMage',
  archer: 'Archer',
}

export const CLASS_INITIAL: Record<string, string> = {
  knight: 'K',
  black_mage: 'B',
  white_mage: 'W',
  archer: 'A',
}

export function waveLabel(wave: number): string {
  return wave >= 11 ? 'boss' : `wave ${wave}/10`
}
