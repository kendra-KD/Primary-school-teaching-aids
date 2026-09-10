import { query, queryOne, withTx } from '../db.js';
import { assertOwnsClass, assertOwnsStudent, assertText, assertUuid, badRequest, notFound } from '../util.js';

// 伙伴种类（原创形象，无 IP 风险）。与前端自选页图鉴保持一致。
const PARTNER_KINDS = [
  // 萌系自然 1-2 年级
  'tuan_tuan', 'ya_ya', 'cloud_sheep', 'star_kid',
  'bunny', 'duckling', 'piggy', 'kitty', 'puppy', 'hug_bear',
  'bub_fish', 'slow_turtle', 'blue_whale', 'little_crab',
  // 生命观察 3-4 年级
  'can_bao', 'ke_dou', 'seed_sprite', 'ant_worker', 'snail',
  'butterfly', 'shy_plant', 'sun_flower', 'mushroom', 'bamboo',
  'crystal', 'minnow',
  // 动漫原创 5-6 年级
  'fire_sprite', 'water_sprite', 'grass_sprite', 'thunder_sprite', 'star2',
  'mech_eco', 'light_spirit', 'ice_spirit', 'wind_spirit', 'rock_spirit',
  'dragon_spirit', 'dark_spirit'
];

export default async function studentRoutes(fastify) {
  const auth = { onRequest: [fastify.authenticate] };

  // 花名册
  fastify.get('/api/classes/:id/students', auth, async (req) => {
    const classId = assertUuid(req.params.id, 'id');
    await assertOwnsClass(req.user.sub, classId);
    const { rows } = await query(
      `SELECT * FROM students WHERE class_id = $1 ORDER BY sort_order NULLS LAST, name`,
      [classId]
    );
    return { students: rows };
  });

  // 单个/批量新增：{ names: ["张三","李四"] } 或 { name: "张三" }
  fastify.post('/api/classes/:id/students', auth, async (req, reply) => {
    const classId = assertUuid(req.params.id, 'id');
    await assertOwnsClass(req.user.sub, classId);

    const raw = req.body?.names ?? (req.body?.name ? [req.body.name] : null);
    if (!Array.isArray(raw) || raw.length === 0) throw badRequest('请提供 names 数组或 name');
    if (raw.length > 80) throw badRequest('单次最多新增 80 人');

    const names = raw.map((n) => assertText(n, '姓名', { max: 20 }));
    const groupName = req.body?.group_name ? assertText(req.body.group_name, '小组名', { max: 20 }) : null;

    const rows = await withTx(async (client) => {
      const { rows: maxRow } = await client.query(
        'SELECT COALESCE(MAX(sort_order), 0) AS m FROM students WHERE class_id=$1',
        [classId]
      );
      let base = Number(maxRow[0].m) || 0;
      const inserted = [];
      for (const name of names) {
        base += 1;
        const { rows: r } = await client.query(
          `INSERT INTO students (class_id, name, sort_order, group_name)
           VALUES ($1, $2, $3, $4) RETURNING *`,
          [classId, name, base, groupName]
        );
        inserted.push(r[0]);
      }
      return inserted;
    });
    return reply.code(201).send({ students: rows });
  });

  // 改名 / 换伙伴 / 调整顺序 / 昵称主色 / 照料恢复
  fastify.put('/api/students/:id', auth, async (req) => {
    const student = await assertOwnsStudent(req.user.sub, assertUuid(req.params.id, 'id'));

    const name = req.body?.name === undefined ? student.name : assertText(req.body.name, '姓名', { max: 20 });
    const partnerKind = req.body?.partner_kind === undefined ? student.partner_kind : req.body.partner_kind;
    if (partnerKind !== null && partnerKind !== undefined && !PARTNER_KINDS.includes(partnerKind)) {
      throw badRequest('partner_kind 非法');
    }
    const nickname = req.body?.nickname === undefined ? student.nickname
      : (req.body.nickname === null ? null : assertText(req.body.nickname, '昵称', { max: 20 }));
    const color = req.body?.color === undefined ? student.color
      : (req.body.color === null ? null : (() => {
          const c = String(req.body.color);
          if (!/^#[0-9a-fA-F]{6}$/.test(c)) throw badRequest('color 必须是 #RRGGBB');
          return c;
        })());
    const sortOrder = req.body?.sort_order === undefined
      ? student.sort_order
      : Number(req.body.sort_order);
    const groupName = req.body?.group_name === undefined
      ? student.group_name
      : req.body.group_name === null
        ? null
        : assertText(req.body.group_name, '小组名', { max: 20 });
    // "照料"动作：把受伤/蔫了的伙伴养回来（生命科学专属，不羞辱）
    const care = req.body?.care === true;
    const hurt = care ? false : student.hurt;
    const vitality = care ? Math.max(student.vitality, 50) : student.vitality;

    const row = await queryOne(
      `UPDATE students SET name=$1, partner_kind=$2, nickname=$3, color=$4, sort_order=$5, group_name=$6, hurt=$7, vitality=$8
        WHERE id=$9 RETURNING *`,
      [name, partnerKind, nickname, color, sortOrder, groupName, hurt, vitality, student.id]
    );
    return { student: row };
  });

  // 学生端自主认领伙伴（免登录，凭学生 id 写入，可重复认领由老师端覆盖）
  fastify.post('/api/students/:id/claim', async (req, reply) => {
    const studentId = assertUuid(req.params.id, 'id');
    const kind = req.body?.partner_kind;
    if (!kind || !PARTNER_KINDS.includes(kind)) throw badRequest('partner_kind 非法');
    const nickname = req.body?.nickname ? assertText(req.body.nickname, '昵称', { max: 20 }) : null;
    const color = req.body?.color
      ? (() => {
          const c = String(req.body.color);
          if (!/^#[0-9a-fA-F]{6}$/.test(c)) throw badRequest('color 必须是 #RRGGBB');
          return c;
        })()
      : null;

    const row = await queryOne(
      `UPDATE students SET partner_kind=$1, nickname=COALESCE($2, nickname), color=COALESCE($3, color)
        WHERE id=$4 RETURNING *`,
      [kind, nickname, color, studentId]
    );
    if (!row) throw notFound('学生不存在');
    await query('INSERT INTO partner_claims (student_id, kind) VALUES ($1, $2)', [studentId, kind]);
    return { student: row };
  });

  fastify.delete('/api/students/:id', auth, async (req, reply) => {
    const student = await assertOwnsStudent(req.user.sub, assertUuid(req.params.id, 'id'));
    await query('DELETE FROM students WHERE id=$1', [student.id]);
    return reply.code(204).send();
  });
}
