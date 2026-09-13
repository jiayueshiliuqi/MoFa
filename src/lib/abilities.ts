/**
 * 模型能力识别：按模型名关键词启发式检测（与 Cherry Studio 同类做法），
 * 支持用户在服务商设置里手动覆盖个别模型的判定。
 */
export interface ModelAbilities {
  /** 支持图片输入（视觉） */
  vision: boolean
  /** 推理/思考型模型 */
  reasoning: boolean
}

const VISION_HINTS = [
  'vision', 'vl', '4o', '4.1', '4.5', 'gpt-5', 'o3', 'o4', 'qvq', 'llava',
  'pixtral', 'gemini', 'claude', 'glm-4v', 'glm-4.5v', 'glm-4.6v', 'grok-4',
]

const REASONING_HINTS = ['r1', 'reasoner', 'o1', 'o3', 'o4', 'qwq', 'thinking', 'ponder']

export function detectAbilities(modelId: string): ModelAbilities {
  const id = modelId.toLowerCase()
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
