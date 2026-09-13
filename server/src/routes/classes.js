import bcrypt from 'bcryptjs';
import { query, queryOne } from '../db.js';
import { assertOwnsClass, assertText, assertInt, assertUuid, badRequest, notFound, unauthorized } from '../util.js';

const THEME_PACKS = ['cute_nature', 'life_obs', 'anime_original'];

function rowToClass(row, extra = {}) {
  return {
    id: row.id,
    name: row.name,
    class_code: row.class_code || null,
    switch_code_set: !!row.switch_code,   // R70: 只返回是否已设置，不返回明文
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
      themePack = grade <= 2 ? 'cute_nature' : grade <= 4 ? 'life_obs' : 'anime_original';
    }

    const row = await queryOne(
      `INSERT INTO classes (teacher_id, name, grade, theme, theme_pack)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.user.sub, name, grade, theme, themePack]
    );
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

  // R70: 设置/修改切班码（需验证老师登录密码）
  // body: { password: '登录密码', switch_code: '新切班码（4-12位）' }
  fastify.put('/api/classes/:id/switch-code', auth, async (req, reply) => {
    const id = assertUuid(req.params.id, 'id');
    await assertOwnsClass(req.user.sub, id);

    const password = String(req.body?.password || '');
    const newCode = String(req.body?.switch_code || '').trim();

    if (!password) throw badRequest('请输入登录密码以验证身份');
    if (newCode.length < 4) throw badRequest('切班码至少 4 位');
    if (newCode.length > 12) throw badRequest('切班码最多 12 位');
    if (!/^[A-Za-z0-9]+$/.test(newCode)) throw badRequest('切班码只能用字母和数字');

    // 验证登录密码
    const teacher = await queryOne('SELECT password_hash FROM teachers WHERE id = $1', [req.user.sub]);
    if (!teacher) throw unauthorized('账号异常');
    const ok = await bcrypt.compare(password, teacher.password_hash);
    if (!ok) throw badRequest('登录密码不正确，切班码未修改');

    await query('UPDATE classes SET switch_code = $1 WHERE id = $2 AND teacher_id = $3', [newCode, id, req.user.sub]);
    return { ok: true, switch_code_set: true };
  });

  // R70: 验证切班码（已登录老师验证码是否正确）
  // body: { switch_code: '切班码' } → { ok: true/false }
  fastify.post('/api/classes/:id/verify-switch', auth, async (req, reply) => {
    const id = assertUuid(req.params.id, 'id');
    const cls = await assertOwnsClass(req.user.sub, id);
    const input = String(req.body?.switch_code || '').trim();
    if (!cls.switch_code) {
      // 未设置切班码：已登录老师直接放行
      return { ok: true, reason: 'no_code' };
    }
    return { ok: input.toLowerCase() === String(cls.switch_code).toLowerCase() };
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
