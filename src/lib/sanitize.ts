/**
 * 粘贴内容清理。
 *
 * 背景：从微信 / 网页复制 API Key 时常夹带零宽字符（U+200B~U+200D、U+FEFF），
 * 这类字符不可见、trim() 去不掉，而 HTTP 头不允许非 Latin-1 字符——
 * 带着它们发请求会直接抛 "String contains non ISO-8859-1 code point"。
 */

/**
 * 去掉零宽/不可见字符（保留内部正常空格，用于名称、提示词等文本字段）。
 * 覆盖：零宽空格/连接符（U+200B–200D）、词连接符（U+2060）、方向标记（U+200E/200F）、
 * 双向嵌入/覆盖（U+202A–202E）、双向隔离（U+2066–2069）、BOM（U+FEFF）、软连字符（U+00AD），
 * 以及除 \t\n\r 外的 C0/C1 控制字符。
 */
const INVISIBLE = /[\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g

export function stripInvisible(value: string): string {
  return value.replace(INVISIBLE, '').trim()
}

/**
 * 深度清理：去零宽字符 + 移除所有空白（用于 apiKey / baseURL / 模型名等
 * 不允许包含空格的字段——内部空格同样会导致请求失败）。
 */
export function compactSecret(value: string): string {
  return value.replace(INVISIBLE, '').replace(/\s+/g, '')
}
