import { query, queryOne } from '../db.js';
import { assertOwnsClass, assertUuid, assertText, badRequest, notFound, forbidden } from '../util.js';
import { getActiveLesson, generatePin, assertLessonSession } from '../middleware.js';

export default async function lessonRoutes(fastify) {
  const auth = { onRequest: [fastify.authenticate] };

  // R49: 开始上课 — 老师选班，签发授课会话令牌
  fastify.post('/api/classes/:id/lesson/start', auth, async (req, reply) => {
    const classId = assertUuid(req.params.id, 'id');
    const cls = await assertOwnsClass(req.user.sub, classId);

    // 如果当前已有活跃会话，先结束旧会话
    const existing = await getActiveLesson(req.user.sub);
    if (existing) {
      await query('UPDATE lesson_sessions SET active=false, ended_at=now() WHERE id=$1', [existing.id]);
    }

    const pin = generatePin();
    const session = await queryOne(
      `INSERT INTO lesson_sessions (teacher_id, class_id, pin, expires_at)
       VALUES ($1, $2, $3, now() + interval '90 minutes')
       RETURNING *`,
      [req.user.sub, classId, pin]
    );

    return reply.code(201).send({
      lesson_token: session.id,
      pin,
      class: { id: cls.id, name: cls.name, grade: cls.grade },
      expires_at: session.expires_at,
      message: '授课会话已开启，90 分钟后自动结束'
    });
  });

  // R51: 下课 — 手动结束授课会话
  fastify.delete('/api/classes/:id/lesson', auth, async (req, reply) => {
    const classId = assertUuid(req.params.id, 'id');
    await assertOwnsClass(req.user.sub, classId);

    const session = await getActiveLesson(req.user.sub);
    if (!session) throw notFound('当前没有正在进行的授课会话');

    await query(
      'UPDATE lesson_sessions SET active=false, ended_at=now() WHERE id=$1',
      [session.id]
    );

    return reply.code(200).send({ message: '已下课，授课会话已结束' });
  });

  // R49: 查询当前授课状态
  fastify.get('/api/classes/:id/lesson', auth, async (req) => {
    const classId = assertUuid(req.params.id, 'id');
    await assertOwnsClass(req.user.sub, classId);

    const session = await getActiveLesson(req.user.sub);
    if (!session) return { active: false };

    return {
      active: true,
      lesson_token: session.id,
      pin: session.pin,
      started_at: session.started_at,
      expires_at: session.expires_at
    };
  });

  // R50: 验证切班 PIN
  fastify.post('/api/classes/:id/lesson/verify-pin', auth, async (req, reply) => {
    const classId = assertUuid(req.params.id, 'id');
    await assertOwnsClass(req.user.sub, classId);

    const pin = req.body?.pin;
    if (!pin) throw badRequest('请输入 PIN 码');

    const session = await getActiveLesson(req.user.sub);
    if (!session) throw notFound('当前没有正在进行的授课会话');

    if (session.pin !== pin) throw forbidden('PIN 码不正确');

    return { verified: true, lesson_token: session.id };
  });

  // R46: 老师审批换伙伴申请
  fastify.get('/api/classes/:id/partner-requests', auth, async (req) => {
    const classId = assertUuid(req.params.id, 'id');
    await assertOwnsClass(req.user.sub, classId);

    const { rows } = await query(
      `SELECT r.*, s.name AS student_name, s.partner_kind AS current_kind
       FROM partner_change_requests r
       JOIN students s ON s.id = r.student_id
       WHERE r.class_id = $1 AND r.status = 'pending'
       ORDER BY r.created_at DESC`,
      [classId]
    );
    return { requests: rows };
  });

  fastify.post('/api/classes/:id/partner-requests/:reqId', auth, async (req, reply) => {
    const classId = assertUuid(req.params.id, 'id');
    await assertOwnsClass(req.user.sub, classId);
    const reqId = assertUuid(req.params.reqId, 'reqId');

    const action = req.body?.action;
    if (!['approve', 'deny'].includes(action)) throw badRequest('action 必须是 approve 或 deny');

    const request = await queryOne(
      'SELECT * FROM partner_change_requests WHERE id=$1 AND class_id=$2 AND status=$3',
      [reqId, classId, 'pending']
    );
    if (!request) throw notFound('申请不存在或已处理');

    if (action === 'approve') {
      await query(
        `UPDATE students SET partner_kind=$1 WHERE id=$2`,
        [request.requested_kind, request.student_id]
      );
      await query(
        `UPDATE partner_change_requests SET status='approved', resolved_at=now(), resolved_by=$1 WHERE id=$2`,
        [req.user.sub, reqId]
      );
      await query(
        'INSERT INTO partner_claims (student_id, kind) VALUES ($1, $2)',
        [request.student_id, request.requested_kind]
      );
      return reply.code(200).send({ message: '换伙伴申请已批准', approved: true });
    } else {
      await query(
        `UPDATE partner_change_requests SET status='denied', resolved_at=now(), resolved_by=$1 WHERE id=$2`,
        [req.user.sub, reqId]
      );
      return reply.code(200).send({ message: '换伙伴申请已驳回', approved: false });
    }
  });
}
