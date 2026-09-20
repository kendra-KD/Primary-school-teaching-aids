import { query, queryOne } from '../db.js';
import { assertOwnsClass, assertText, assertInt, assertUuid, badRequest, notFound } from '../util.js';
import { LABELS, LABEL_KEYS } from '../labels.js';

// 合法标签 key
function validateLabels(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.filter(k => LABEL_KEYS.includes(k));
}

export default async function quizRoutes(fastify) {
  const auth = { onRequest: [fastify.authenticate] };

  // R33: 老师录题（单个或批量）
  fastify.post('/api/classes/:id/questions', auth, async (req, reply) => {
    const classId = assertUuid(req.params.id, 'id');
    await assertOwnsClass(req.user.sub, classId);

    const items = Array.isArray(req.body?.questions) ? req.body.questions : [req.body];
    if (!items.length) throw badRequest('请提供至少一道题');

    const inserted = [];
    for (const item of items) {
      const question = assertText(item.question, '题目', { max: 500 });
      const options = item.options;
      if (!Array.isArray(options) || options.length < 2 || options.length > 6)
        throw badRequest('选项必须是 2-6 个');
      const validatedOptions = options.map(o => assertText(o, '选项', { max: 200 }));
      const answer = assertInt(item.answer, '正确答案索引', { min: 0, max: validatedOptions.length - 1 });
      const explanation = item.explanation ? assertText(item.explanation, '解析', { max: 500 }) : null;
      const unit = item.unit ? assertText(item.unit, '单元', { max: 30 }) : null;
      const grade = item.grade === undefined || item.grade === null ? null : assertInt(item.grade, '年级', { min: 1, max: 6 });
      // R30: 关联推荐标签
      const recommendedLabels = validateLabels(item.recommended_labels || []);

      const row = await queryOne(
        `INSERT INTO questions (class_id, grade, unit, question, options, answer, explanation, created_by, recommended_labels)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
        [classId, grade, unit, question, JSON.stringify(validatedOptions), answer, explanation, req.user.sub, JSON.stringify(recommendedLabels)]
      );
      inserted.push(row);
    }
    return reply.code(201).send({ questions: inserted, count: inserted.length });
  });

  // R33: 老师查看题库
  fastify.get('/api/classes/:id/questions', auth, async (req) => {
    const classId = assertUuid(req.params.id, 'id');
    await assertOwnsClass(req.user.sub, classId);

    const { rows } = await query(
      `SELECT * FROM questions WHERE class_id = $1 ORDER BY created_at DESC`,
      [classId]
    );
    return { questions: rows };
  });

  // R33: 更新题目
  fastify.put('/api/questions/:id', auth, async (req) => {
    const qId = assertUuid(req.params.id, 'id');
    const q = await queryOne('SELECT * FROM questions WHERE id = $1', [qId]);
    if (!q) throw notFound('题目不存在');

    const question = req.body?.question === undefined ? q.question : assertText(req.body.question, '题目', { max: 500 });
    const options = req.body?.options === undefined ? q.options : (() => {
      if (!Array.isArray(req.body.options) || req.body.options.length < 2 || req.body.options.length > 6)
        throw badRequest('选项必须是 2-6 个');
      return req.body.options.map(o => assertText(o, '选项', { max: 200 }));
    })();
    const answer = req.body?.answer === undefined ? q.answer : assertInt(req.body.answer, '正确答案索引', { min: 0, max: options.length - 1 });
    const explanation = req.body?.explanation === undefined ? q.explanation
      : (req.body.explanation === null ? null : assertText(req.body.explanation, '解析', { max: 500 }));
    const unit = req.body?.unit === undefined ? q.unit
      : (req.body.unit === null ? null : assertText(req.body.unit, '单元', { max: 30 }));
    const isActive = req.body?.is_active === undefined ? q.is_active : req.body.is_active;

    const row = await queryOne(
      `UPDATE questions SET question=$1, options=$2, answer=$3, explanation=$4, unit=$5, is_active=$6
       WHERE id=$7 RETURNING *`,
      [question, JSON.stringify(options), answer, explanation, unit, isActive, qId]
    );
    return { question: row };
  });

  // R33: 删除题目
  fastify.delete('/api/questions/:id', auth, async (req, reply) => {
    const qId = assertUuid(req.params.id, 'id');
    await query('DELETE FROM questions WHERE id=$1', [qId]);
    return reply.code(204).send();
  });

  // R30: 获取班级推荐标签（去重合并所有题目的 recommended_labels）
  fastify.get('/api/classes/:id/recommended-labels', auth, async (req) => {
    const classId = assertUuid(req.params.id, 'id');
    await assertOwnsClass(req.user.sub, classId);
    const { rows } = await query(
      `SELECT DISTINCT jsonb_array_elements_text(recommended_labels) AS label
       FROM questions WHERE class_id = $1 AND is_active = true
         AND recommended_labels IS NOT NULL AND recommended_labels != '[]'::JSONB`,
      [classId]
    );
    const labels = rows.map(r => r.label).filter(Boolean);
    return { labels };
  });

  // R66: AI 出题简化版（PRD 闭环 B 核心）
  // 老师粘贴教学要点 → LLM 生成 8-12 题草稿 JSON → 前端预览编辑 → 走现有批量入库接口
  // 不入库，只返回草稿；LLM 走 OpenAI 兼容协议（tos.run / DeepSeek / 通义 / Kimi 均可）
  fastify.post('/api/classes/:id/questions/ai-generate', auth, async (req, reply) => {
    const classId = assertUuid(req.params.id, 'id');
    await assertOwnsClass(req.user.sub, classId);

    const points = assertText(req.body?.points, '教学要点', { max: 500, min: 2 });
    const count = req.body?.count === undefined ? 10 : assertInt(req.body.count, '题目数量', { min: 4, max: 12 });
    const grade = req.body?.grade === undefined || req.body?.grade === null ? null : assertInt(req.body.grade, '年级', { min: 1, max: 6 });
    const unit = req.body?.unit ? assertText(req.body.unit, '单元', { max: 30 }) : null;

    const baseUrl = process.env.LLM_BASE_URL;
    const apiKey = process.env.LLM_API_KEY;
    const model = process.env.LLM_MODEL || 'deepseek-chat';
    if (!baseUrl || !apiKey) throw httpError(503, 'AI 出题未配置：请在 .env 设置 LLM_BASE_URL / LLM_API_KEY / LLM_MODEL');

    const gradeHint = grade ? `（${grade}年级难度）` : '（小学难度）';
    const unitHint = unit ? `\n本课主题/单元：${unit}` : '';
    const sys = `你是小学科学命题专家。根据老师给的教学要点，生成 ${count} 道单选题草稿，供小学生课间答题使用。${gradeHint}${unitHint}
严格要求：
1. 每题 4 个选项（A/B/C/D），只有 1 个正确答案。
2. 题干和选项语言通俗、贴近小学生活，避免生僻字。
3. 难度适中，正确答案位置随机分布。
4. 返回 JSON 数组，元素结构：{"question":"题干","options":["A","B","C","D"],"answer":0,"explanation":"一句话解析"}，answer 是正确选项的索引（0-3）。
5. 不要输出任何多余文字、不要 markdown 代码块，只输出 JSON 数组。`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
      const resp = await fetch(baseUrl.replace(/\/+$/, '') + '/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          messages: [{ role: 'system', content: sys }, { role: 'user', content: `教学要点：\n${points}` }],
          temperature: 0.7,
          max_tokens: 2000
        }),
        signal: controller.signal
      });

      if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        throw httpError(502, `AI 服务异常 (${resp.status})：${errText.slice(0, 200)}`);
      }

      const data = await resp.json();
      const raw = data?.choices?.[0]?.message?.content;
      if (!raw) throw httpError(502, 'AI 返回为空');
      const cleaned = String(raw).replace(/^```(?:json)?/i, '').replace(/```$/g, '').trim();
      let parsed;
      try { parsed = JSON.parse(cleaned); }
      catch { throw httpError(502, 'AI 返回不是合法 JSON，请重试'); }
      if (!Array.isArray(parsed) || !parsed.length) throw httpError(502, 'AI 返回格式异常');

      // 服务端做最后一道结构校验，剔除不合规条目
      const drafts = parsed.filter(q => {
        if (!q || typeof q.question !== 'string' || !q.question.trim()) return false;
        if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 6) return false;
        if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer >= q.options.length) return false;
        return true;
      }).map(q => ({
        question: String(q.question).trim().slice(0, 500),
        options: q.options.map(o => String(o).trim().slice(0, 200)),
        answer: q.answer,
        explanation: q.explanation ? String(q.explanation).trim().slice(0, 500) : '',
        grade, unit, recommended_labels: []
      }));

      if (!drafts.length) throw httpError(502, 'AI 生成的题目未通过格式校验，请重试或调整要点');
      return { drafts, count: drafts.length, model };
    } catch (err) {
      if (err.name === 'AbortError') throw httpError(504, 'AI 响应超时（30s），请重试或精简教学要点');
      if (err.statusCode) throw err;
      throw httpError(502, `AI 调用失败：${err.message || '未知错误'}`);
    } finally {
      clearTimeout(timer);
    }
  });
}
