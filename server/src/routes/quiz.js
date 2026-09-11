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
}
