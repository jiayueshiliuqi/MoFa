/**
 * 模型能力识别：按模型名关键词启发式检测，
 * 支持用户在服务商设置里手动覆盖个别模型的判定。
 */
export interface ModelAbilities {
  /** 支持图片输入（视觉） */
  vision: boolean
  /** 推理/思考型模型 */
  reasoning: boolean
}

const VISION_HINTS = [
  'vision', 'vl', '-4o', 'gpt-4o', 'gpt-4.1', 'gpt-4.5', 'gpt-5', 'o3', 'o4', 'qvq',
  'llava', 'pixtral', 'gemini', 'claude', 'glm-4v', 'glm-4.5v', 'glm-4.6v', 'grok-4',
]

const REASONING_HINTS = [
  'r1', 'reasoner', 'o1', 'o3', 'o4', 'qwq', 'thinking', 'ponder',
  'gpt-5', 'gemini-2.5', 'gemini-3', 'claude-3-7', 'claude-4', 'sonnet-4', 'opus-4',
]

export function detectAbilities(modelId: string): ModelAbilities {
  const id = modelId.toLowerCase()
  // `4.1`/`4.5` 这类子串会把 glm-4.1 / glm-4.5（纯文本）误判成视觉模型，
  // 因此视觉判定只用带厂商前缀的完整标识
  return {
    vision: VISION_HINTS.some((k) => id.includes(k)),
    reasoning: REASONING_HINTS.some((k) => id.includes(k)),
  }
}

/** 合并自动检测与用户覆盖，得到生效能力 */
export function effectiveAbilities(
  modelId: string,
  overrides?: { vision?: boolean; reasoning?: boolean },
): ModelAbilities {
  const detected = detectAbilities(modelId)
  return {
    vision: overrides?.vision ?? detected.vision,
    reasoning: overrides?.reasoning ?? detected.reasoning,
  }
}
