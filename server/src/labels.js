// 科学学科专属行为标签（预置、零备课）
// delta 由服务端决定，前端不得传分值，防止刷分
// eco: 该行为是否计入班级生态值；vine: 是否触发伙伴间藤蔓

export const LABELS = {
  ask_question: { name: '提出好问题 / 大胆猜想', group: '思维', delta: 2, eco: 1, vine: false, fx: 'bloom' },
  conclude: { name: '完整表达探究结论', group: '思维', delta: 3, eco: 1, vine: false, fx: 'evolve' },

  safe_op: { name: '规范操作实验', group: '实验', delta: 2, eco: 1, vine: false, fx: 'glow' },
  safety_remind: { name: '安全提醒 / 保护同伴', group: '实验', delta: 2, eco: 1, vine: true, fx: 'glow' },

  observe: { name: '认真观察并记录', group: '观察', delta: 2, eco: 1, vine: false, fx: 'leaf' },
  reading: { name: '科学阅读 / 资料打卡', group: '观察', delta: 1, eco: 1, vine: false, fx: 'leaf' },

  love_life: { name: '爱护实验生物 / 植物', group: '生命', delta: 3, eco: 1, vine: false, fx: 'hug' },

  cooperate: { name: '小组合作探究', group: '合作', delta: 2, eco: 1, vine: true, fx: 'vine' },
  help_mate: { name: '帮助同学 / 分享发现', group: '合作', delta: 2, eco: 1, vine: true, fx: 'vine' },

  engineering: { name: '创新小制作 / 工程挑战', group: '工程', delta: 3, eco: 1, vine: false, fx: 'evolve' },

  tidy_up: { name: '主动整理 / 归位器材', group: '责任', delta: 2, eco: 1, vine: false, fx: 'tidy' },
  persist_observe: { name: '坚持长期观察', group: '责任', delta: 3, eco: 1, vine: false, fx: 'evolve' },

  // 负向：可恢复、不羞辱
  unsafe_act: { name: '不安全操作', group: '恢复', delta: -2, eco: 0, vine: false, fx: 'droop', negative: true },
  hurt_life: { name: '怠慢实验生物 / 植物', group: '恢复', delta: -3, eco: 0, vine: false, fx: 'hurt', negative: true },
  untidy: { name: '器材未归位', group: '恢复', delta: -1, eco: 0, vine: false, fx: 'mess', negative: true }
};

export const LABEL_KEYS = Object.keys(LABELS);

export function getLabel(key) {
  return LABELS[key] || null;
}

// 伙伴进化阈值（累计成长值 → stage 0..3）
export const STAGE_THRESHOLDS = [0, 12, 35, 70];

export function stageOf(growth) {
  let stage = 0;
  for (let i = 0; i < STAGE_THRESHOLDS.length; i++) {
    if (growth >= STAGE_THRESHOLDS[i]) stage = i;
  }
  return stage;
}

// 班级生态阶段（累计生态值 → 荒芜/绿意/繁荣）
export const CLASS_STAGES = [
  { key: 'wild', name: '荒芜', min: 0 },
  { key: 'green', name: '绿意', min: 120 },
  { key: 'bloom', name: '繁荣', min: 360 }
];

export function classStageOf(ecoValue) {
  let cur = CLASS_STAGES[0];
  for (const s of CLASS_STAGES) if (ecoValue >= s.min) cur = s;
  const idx = CLASS_STAGES.indexOf(cur);
  const next = CLASS_STAGES[idx + 1] || null;
  return {
    key: cur.key,
    name: cur.name,
    next: next ? next.name : null,
    progress: next ? (ecoValue - cur.min) / (next.min - cur.min) : 1
  };
}

// 活力阈值：低于 30 视为"蔫了"（可恢复，次日养回）
export const DROOP_THRESHOLD = 30;
