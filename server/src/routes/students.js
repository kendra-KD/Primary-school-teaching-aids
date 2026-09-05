import { query, queryOne, withTx } from '../db.js';
import { assertOwnsClass, assertOwnsStudent, assertText, assertUuid, badRequest } from '../util.js';

const PARTNER_KINDS = [
  'tuan_tuan', 'ya_ya', 'cloud_sheep', 'star_kid',
  'can_bao', 'ke_dou', 'crystal', 'seed_sprite', 'ant_worker',
  'fire_sprite', 'water_sprite', 'grass_sprite', 'thunder_sprite', 'mech_eco'
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

  // 改名 / 换伙伴 / 调整顺序 / 照料恢复
  fastify.put('/api/students/:id', auth, async (req) => {
    const student = await assertOwnsStudent(req.user.sub, assertUuid(req.params.id, 'id'));

    const name = req.body?.name === undefined ? student.name : assertText(req.body.name, '姓名', { max: 20 });
    const partnerKind = req.body?.partner_kind === undefined ? student.partner_kind : req.body.partner_kind;
    if (partnerKind !== null && partnerKind !== undefined && !PARTNER_KINDS.includes(partnerKind)) {
      throw badRequest('partner_kind 非法');
    }
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
      `UPDATE students SET name=$1, partner_kind=$2, sort_order=$3, group_name=$4, hurt=$5, vitality=$6
        WHERE id=$7 RETURNING *`,
      [name, partnerKind, sortOrder, groupName, hurt, vitality, student.id]
    );
    return { student: row };
  });

  fastify.delete('/api/students/:id', auth, async (req, reply) => {
    const student = await assertOwnsStudent(req.user.sub, assertUuid(req.params.id, 'id'));
    await query('DELETE FROM students WHERE id=$1', [student.id]);
    return reply.code(204).send();
  });
}
