/**
 * 按实际字体量文字宽度（用于矩阵标签）。标题最大宽度用 ch 表示（1ch = 当前字体里"0"的宽度），
 * 随当前字号变化；所有语言用同一个宽度，超出按量出来的宽度截断并加省略号，不按字符数截断。
 */

/** 矩阵标签标题的最大宽度（ch） */
export const TITLE_MAX_CH = 45;

export interface TextMeasure {
  /** 文字宽度（与字号同一单位） */
  width: (text: string) => number;
  /** 1ch 的宽度 */
  ch: number;
}

/** 不超过 maxWidth：原样返回；超出则取最长的前缀加"…"，使整体宽度不超过 maxWidth */
export function fitToWidth(
  text: string,
  maxWidth: number,
  measure: TextMeasure,
): { text: string; width: number } {
  const full = measure.width(text);
  if (full <= maxWidth) return { text, width: full };
  const chars = Array.from(text);
  // 二分查找最长的可用前缀
  let lo = 0;
  let hi = chars.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measure.width(`${chars.slice(0, mid).join('')}…`) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  const out = `${chars.slice(0, lo).join('').trimEnd()}…`;
  return { text: out, width: measure.width(out) };
}

/** 没有浏览器画布时（服务端、测试）的估算：全角字符按字号，其余按 0.6 倍字号 */
export function estimateMeasure(fontSize: number): TextMeasure {
  const isWide = (c: string) => /[⺀-￿]/.test(c);
  const width = (text: string) =>
    Array.from(text).reduce((sum, c) => sum + (isWide(c) ? fontSize : fontSize * 0.6), 0);
  return { width, ch: width('0') };
}

/** 用浏览器画布按给定的 CSS 字体量宽度 */
export function canvasMeasure(font: string): TextMeasure | null {
  if (typeof document === 'undefined') return null;
  const context = document.createElement('canvas').getContext('2d');
  if (!context) return null;
  context.font = font;
  const cache = new Map<string, number>();
  const width = (text: string) => {
    let w = cache.get(text);
    if (w === undefined) {
      w = context.measureText(text).width;
      cache.set(text, w);
    }
    return w;
  };
  return { width, ch: width('0') };
}
