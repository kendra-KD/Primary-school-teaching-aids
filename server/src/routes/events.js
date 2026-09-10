import { query, queryOne, withTx } from '../db.js';
import {
  assertOwnsClass,
  assertOwnsStudent,
  assertUuid,
  badRequest,
  notFound
} from '../util.js';
import { LABELS, getLabel, stageOf, classStageOf, DROOP_THRESHOLD } from '../labels.js';

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

function studentStatus(row) {
  if (row.hurt) return 'hurt';
  if (row.vitality < DROOP_THRESHOLD) return 'droop';
  return 'active';
}

function shapeStudent(row) {
  return {
    id: row.id,
    name: row.name,
    group_name: row.group_name,
    partner_kind: row.partner_kind,
    partner_stage: row.partner_stage,
    growth: Number(row.growth || 0),
    today_score: Number(row.today_score || 0),
    vitality: row.vitality,
    ask: Number(row.ask_count || 0),
    love_count: Number(row.love_count || 0),
    loved: row.loved,
    hurt: row.hurt,
    status: studentStatus(row)
  };
}

export default async function eventRoutes(fastify) {
  const auth = { onRequest: [fastify.authenticate] };

  // 标签字典（前端首次拉取，保证与服务端一致）
  fastify.get('/api/labels', auth, async () => ({ labels: LABELS }));

  // 提交一条点评：两步操作（点伙伴 → 点标签），分值由服务端决定
  fastify.post('/api/events', auth, async (req, reply) => {
    const classId = assertUuid(req.body?.class_id, 'class_id');
    const studentId = assertUuid(req.body?.student_id, 'student_id');
    const partnerId = req.body?.partner_id ? assertUuid(req.body.partner_id, 'partner_id') : null;

    await assertOwnsClass(req.user.sub, classId);
    const student = await assertOwnsStudent(req.user.sub, studentId);
    if (student.class_id !== classId) throw badRequest('该学生不属于此班级');

    const labelKey = req.body?.label_key;
    const label = getLabel(labelKey);
    if (!label) throw badRequest('未知的行为标签');

    let partnerName = null;
    if (partnerId) {
      if (partnerId === studentId) throw badRequest('协作对象不能是自己');
      const p = await assertOwnsStudent(req.user.sub, partnerId);
      if (p.class_id !== classId) throw badRequest('协作对象不属于此班级');
      partnerName = p.name;
    }

    const result = await withTx(async (client) => {
      const { rows: evRows } = await client.query(
        `INSERT INTO events (class_id, student_id, teacher_id, label_key, delta)
         VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [classId, studentId, req.user.sub, labelKey, label.delta]
      );

      const { rows: growthRows } = await client.query(
        'SELECT COALESCE(SUM(delta),0)::INT AS growth FROM events WHERE student_id=$1',
        [studentId]
      );
      const growth = Number(growthRows[0].growth);

      const nextVitality = clamp(student.vitality + label.delta * 3, 0, 100);
      const nextHurt = labelKey === 'hurt_life' ? true : labelKey === 'love_life' ? false : student.hurt;
      const nextLoved = labelKey === 'love_life' ? true : student.loved;

      const { rows: stRows } = await client.query(
        `UPDATE students
            SET vitality=$1, partner_stage=$2, hurt=$3, loved=$4
          WHERE id=$5 RETURNING *`,
        [nextVitality, stageOf(growth), nextHurt, nextLoved, studentId]
      );

      // 合作类行为：在两名同学之间生长藤蔓
      if (label.vine && partnerId) {
        await client.query(
          `INSERT INTO vines (class_id, a_id, b_id, label_key)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT DO NOTHING`,
          [classId, studentId, partnerId, labelKey]
        );
      }

      // 班级生态值：只累加正向行为
      if (label.delta > 0) {
        await client.query(
          'UPDATE classes SET eco_value = eco_value + $1 WHERE id=$2',
          [label.delta, classId]
        );
      }

      return { event: evRows[0], student: stRows[0], growth };
    });

    const cls = await queryOne('SELECT eco_value FROM classes WHERE id=$1', [classId]);
    const stageInfo = classStageOf(Number(cls.eco_value));

    return reply.code(201).send({
      event: result.event,
      student: shapeStudent({ ...result.student, growth: result.growth, today_score: result.event.delta }),
      fx: label.fx,
      label_name: label.name,
      partner_name: partnerName,
      class_stage: stageInfo
    });
  });

  // 全班实时状态（老师大屏核心接口：伙伴墙 + 光荣榜 + 进度环）
  fastify.get('/api/classes/:id/state', auth, async (req) => {
    const classId = assertUuid(req.params.id, 'id');
    const cls = await assertOwnsClass(req.user.sub, classId);

    const { rows: studentRows } = await query(
      `SELECT s.*,
              (COALESCE(g.growth, 0) + COALESCE(a.act_points, 0))::INT AS growth,
              COALESCE(g.today_score, 0)::INT AS today_score,
              COALESCE(g.ask_count, 0)::INT   AS ask_count,
              COALESCE(g.love_count, 0)::INT  AS love_count
         FROM students s
         LEFT JOIN (
           SELECT student_id,
                  SUM(delta) AS growth,
                  SUM(delta) FILTER (WHERE created_at >= date_trunc('day', now())) AS today_score,
                  COUNT(*) FILTER (WHERE label_key = 'ask_question') AS ask_count,
                  COUNT(*) FILTER (WHERE label_key = 'love_life')    AS love_count
             FROM events WHERE class_id = $1
            GROUP BY student_id
         ) g ON g.student_id = s.id
         LEFT JOIN (
           SELECT student_id, SUM(points)::INT AS act_points
             FROM student_activities WHERE class_id = $1 GROUP BY student_id
         ) a ON a.student_id = s.id
        WHERE s.class_id = $1
        ORDER BY s.sort_order NULLS LAST, s.name`,
      [classId]
    );

    const { rows: boardRows } = await query(
      `SELECT s.id, s.name,
              (COALESCE(SUM(e.delta), 0) + COALESCE(a.act_points, 0))::INT AS growth,
              COUNT(*) FILTER (WHERE e.label_key = 'ask_question')::INT AS ask_count,
              COUNT(*) FILTER (WHERE e.label_key = 'love_life')::INT    AS love_count
         FROM students s
         LEFT JOIN events e ON e.student_id = s.id AND e.class_id = $1
         LEFT JOIN (
           SELECT student_id, SUM(points)::INT AS act_points
             FROM student_activities WHERE class_id = $1 GROUP BY student_id
         ) a ON a.student_id = s.id
        WHERE s.class_id = $1
        GROUP BY s.id, s.name`,
      [classId]
    );

    const { rows: vineRows } = await query(
      `SELECT a_id, b_id, label_key, created_at FROM vines WHERE class_id = $1 ORDER BY created_at DESC LIMIT 200`,
      [classId]
    );

    const { rows: tidyRows } = await query(
      `SELECT COALESCE(SUM(delta), 0)::INT AS tidy_score
         FROM events
        WHERE class_id = $1 AND label_key IN ('tidy_up', 'untidy')`,
      [classId]
    );

    const { rows: todayRows } = await query(
      `SELECT COUNT(*)::INT AS n FROM events
        WHERE class_id = $1 AND created_at >= date_trunc('day', now())`,
      [classId]
    );

    const byGrowth = [...boardRows].sort((a, b) => b.growth - a.growth);
    const byAsk = [...boardRows].sort((a, b) => b.ask_count - a.ask_count);
    const byLove = [...boardRows].sort((a, b) => b.love_count - a.love_count);

    const ecoValue = Number(cls.eco_value);
    return {
      class: {
        id: cls.id,
        name: cls.name,
        grade: cls.grade,
        theme: cls.theme,
        theme_pack: cls.theme_pack,
        eco_value: ecoValue,
        stage: classStageOf(ecoValue)
      },
      students: studentRows.map(shapeStudent),
      board: {
        top_growth: byGrowth.slice(0, 5).map((r) => ({ id: r.id, name: r.name, growth: r.growth })),
        top_ask: byAsk.filter((r) => r.ask_count > 0).slice(0, 3)
          .map((r) => ({ id: r.id, name: r.name, count: r.ask_count })),
        life_guardian: byLove.filter((r) => r.love_count > 0).slice(0, 3)
          .map((r) => ({ id: r.id, name: r.name, count: r.love_count })),
        tidiness: clamp(60 + Number(tidyRows[0]?.tidy_score || 0) * 4, 0, 100)
      },
      vines: vineRows.map((v) => ({ a_id: v.a_id, b_id: v.b_id, label_key: v.label_key })),
      today_events: Number(todayRows[0]?.n || 0)
    };
  });

  // 撤销最近一条点评（老师点错了，课堂刚需）
  fastify.delete('/api/events/:id', auth, async (req, reply) => {
    const eventId = assertUuid(req.params.id, 'id');
    const ev = await queryOne(
      `SELECT e.*, c.teacher_id FROM events e JOIN classes c ON c.id = e.class_id WHERE e.id = $1`,
      [eventId]
    );
    if (!ev) throw notFound('点评记录不存在');
    if (ev.teacher_id !== req.user.sub) throw notFound('点评记录不存在');

    await withTx(async (client) => {
      await client.query('DELETE FROM events WHERE id=$1', [eventId]);
      const { rows } = await client.query(
        'SELECT COALESCE(SUM(delta),0)::INT AS growth FROM events WHERE student_id=$1',
        [ev.student_id]
      );
      const growth = Number(rows[0].growth);
      const st = await queryOne('SELECT * FROM students WHERE id=$1', [ev.student_id]);
      if (st) {
        await client.query(
          `UPDATE students SET vitality=$1, partner_stage=$2 WHERE id=$3`,
          [clamp(st.vitality - ev.delta * 3, 0, 100), stageOf(growth), ev.student_id]
        );
      }
      if (ev.delta > 0) {
        await client.query('UPDATE classes SET eco_value = GREATEST(0, eco_value - $1) WHERE id=$2', [
          ev.delta,
          ev.class_id
        ]);
      }
    });

    return reply.code(204).send();
  });
}
