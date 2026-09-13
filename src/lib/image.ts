/**
 * 图片处理：选图后压缩为 data URL（OpenAI vision 直接可用）。
 * 手机照片通常 5-10MB，base64 后请求体过大且慢，统一缩到长边 1568px + JPEG 0.85。
 */
export async function fileToCompressedDataUrl(
  file: File,
  maxSide = 1568,
  quality = 0.85,
): Promise<string> {
  const bitmap = await createImageBitmap(file)
  try {
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
    const w = Math.max(1, Math.round(bitmap.width * scale))
    const h = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('无法创建画布')
    ctx.drawImage(bitmap, 0, 0, w, h)
    return canvas.toDataURL('image/jpeg', quality)
  } finally {
    bitmap.close()
  }
}
