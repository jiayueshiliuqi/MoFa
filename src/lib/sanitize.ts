/**
 * 粘贴内容清理。
 *
 * 背景：从微信 / 网页复制 API Key 时常夹带零宽字符（U+200B~U+200D、U+FEFF），
 * 这类字符不可见、trim() 去不掉，而 HTTP 头不允许非 Latin-1 字符——
 * 带着它们发请求会直接抛 "String contains non ISO-8859-1 code point"。
 */

/** 去掉零宽/不可见字符（保留内部正常空格，用于名称、提示词等文本字段） */
export function stripInvisible(value: string): string {
  return value.replace(/[\u200B-\u200D\uFEFF\u00AD]/g, '').trim()
}

/**
 * 深度清理：去零宽字符 + 移除所有空白（用于 apiKey / baseURL / 模型名等
 * 不允许包含空格的字段——内部空格同样会导致请求失败）。
 */
export function compactSecret(value: string): string {
  return value.replace(/[\u200B-\u200D\uFEFF\u00AD\s]+/g, '')
}
