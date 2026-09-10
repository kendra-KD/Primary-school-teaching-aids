import { query, queryOne } from '../db.js';
import { assertOwnsClass, assertText, assertInt, assertUuid, badRequest, notFound } from '../util.js';

const THEME_PACKS = ['cute_nature', 'life_obs', 'anime_original'];

function rowToClass(row, extra = {}) {
  return {
    id: row.id,
    name: row.name,
    class_code: row.class_code || null,
    grade: row.grade,
    theme: row.theme,
    theme_pack: row.theme_pack,
    stage: row.stage,
    eco_value: row.eco_value,
    created_at: row.created_at,
    ...extra
  };
}

export default async function classRoutes(fastify) {
  const auth = { onRequest: [fastify.authenticate] };

  // 学生端入班：凭班级码获取班级信息与名单（免登录，仅返回必要字段）
  fastify.get('/api/join/:code', async (req, reply) => {
    const code = String(req.params.code || '').trim().toLowerCase();
    if (!code) throw badRequest('请提供班级码');
    const cls = await queryOne('SELECT * FROM classes WHERE class_code = $1', [code]);
    if (!cls) throw notFound('班级码无效，请向老师确认');
    const { rows } = await query(
      `SELECT id, name, nickname, partner_kind, color
         FROM students WHERE class_id = $1
        ORDER BY sort_order NULLS LAST, name`,
      [cls.id]
    );
    return { class: rowToClass(cls), students: rows };
  });

  // 班级列表：卡片墙，带学生数
  fastify.get('/api/classes', auth, async (req) => {
    const { rows } = await query(
      `SELECT c.*, COUNT(s.id)::INT AS student_count
         FROM classes c
         LEFT JOIN students s ON s.class_id = c.id
        WHERE c.teacher_id = $1
        GROUP BY c.id
        ORDER BY c.grade NULLS LAST, c.created_at`,
      [req.user.sub]
    );
    return { classes: rows.map((r) => rowToClass(r, { student_count: r.student_count })) };
  });

  fastify.post('/api/classes', auth, async (req, reply) => {
    const name = assertText(req.body?.name, '班级名称', { max: 30 });
    const grade = req.body?.grade === undefined || req.body?.grade === null
      ? null
      : assertInt(req.body.grade, '年级', { min: 1, max: 6 });
    const theme = req.body?.theme ? assertText(req.body.theme, '主题', { max: 30 }) : null;
    let themePack = req.body?.theme_pack || null;
    if (themePack) {
      if (!THEME_PACKS.includes(themePack)) throw badRequest(`theme_pack 只能是 ${THEME_PACKS.join(' / ')}`);
    } else if (grade !== null) {
      // 按年级自动匹配主题包：1-2 萌系自然 / 3-4 生命观察 / 5-6 动漫原创
      themePack = grade <= 2 ? 'cute_nature' : grade <= 4 ? 'life_obs' : 'anime_original';
    }

    const row = await queryOne(
      `INSERT INTO classes (teacher_id, name, grade, theme, theme_pack)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.user.sub, name, grade, theme, themePack]
    );
    // 班级码：取 id 前 6 位十六进制，唯一且无需额外随机源
    await query(`UPDATE classes SET class_code = LEFT(REPLACE(id::text, '-', ''), 6) WHERE id = $1`, [row.id]);
    const full = await queryOne('SELECT * FROM classes WHERE id = $1', [row.id]);
    return reply.code(201).send({ class: rowToClass(full, { student_count: 0 }) });
  });

  fastify.put('/api/classes/:id', auth, async (req) => {
    const id = assertUuid(req.params.id, 'id');
    const cur = await assertOwnsClass(req.user.sub, id);

    const name = req.body?.name === undefined ? cur.name : assertText(req.body.name, '班级名称', { max: 30 });
    const grade = req.body?.grade === undefined
      ? cur.grade
      : req.body.grade === null
        ? null
        : assertInt(req.body.grade, '年级', { min: 1, max: 6 });
    const theme = req.body?.theme === undefined ? cur.theme : assertText(req.body.theme, '主题', { max: 30 });
    let themePack = req.body?.theme_pack === undefined ? cur.theme_pack : req.body.theme_pack;
    if (themePack && !THEME_PACKS.includes(themePack)) throw badRequest('theme_pack 非法');

    const row = await queryOne(
      `UPDATE classes SET name=$1, grade=$2, theme=$3, theme_pack=$4
        WHERE id=$5 AND teacher_id=$6 RETURNING *`,
      [name, grade, theme, themePack, id, req.user.sub]
    );
    return { class: rowToClass(row) };
  });

  // 重生成班级码（老师端一键换码，原码立即失效）
  fastify.post('/api/classes/:id/code', auth, async (req) => {
    const id = assertUuid(req.params.id, 'id');
    await assertOwnsClass(req.user.sub, id);
    const row = await queryOne(
      `UPDATE classes SET class_code = LEFT(REPLACE(gen_random_uuid()::text, '-', ''), 6)
        WHERE id=$1 AND teacher_id=$2 RETURNING class_code`,
      [id, req.user.sub]
    );
    if (!row) throw notFound('班级不存在');
    return { class_code: row.class_code };
  });

  fastify.delete('/api/classes/:id', auth, async (req, reply) => {
    const id = assertUuid(req.params.id, 'id');
    await assertOwnsClass(req.user.sub, id);
    await query('DELETE FROM classes WHERE id=$1 AND teacher_id=$2', [id, req.user.sub]);
    return reply.code(204).send();
  });
}
