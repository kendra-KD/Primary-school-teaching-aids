import { query, queryOne, withTx } from '../db.js';
import { assertOwnsClass, assertOwnsStudent, assertText, assertUuid, assertInt, badRequest, notFound } from '../util.js';
import { assertDeviceToken, generateDeviceToken } from '../middleware.js';

// 伙伴种类（原创形象，无 IP 风险）。与前端自选页图鉴保持一致。
const PARTNER_KINDS = [
  'tuan_tuan', 'ya_ya', 'cloud_sheep', 'star_kid',
  'bunny', 'duckling', 'piggy', 'kitty', 'puppy', 'hug_bear',
  'bub_fish', 'slow_turtle', 'blue_whale', 'little_crab',
  'can_bao', 'ke_dou', 'seed_sprite', 'ant_worker', 'snail',
  'butterfly', 'shy_plant', 'sun_flower', 'mushroom', 'bamboo',
  'crystal', 'minnow',
  'fire_sprite', 'water_sprite', 'grass_sprite', 'thunder_sprite', 'star2',
  'mech_eco', 'light_spirit', 'ice_spirit', 'wind_spirit', 'rock_spirit',
  'dragon_spirit', 'dark_spirit',
  // R60 扩充：恐龙系列
  'dino_saurus', 'tricera', 'ptera',
  // R76 扩充：恐龙系列追加（腕龙/剑龙/迅猛龙）
  'brachio', 'stego', 'raptor',
  // R60 扩充：星际精灵系列
  'meteor_spirit', 'nebula_beast', 'void_spirit',
  // R76 扩充：星际精灵追加（彗星/脉冲星）
  'comet_tail', 'pulsar_star',
  // R60 扩充：Xiaolong人系列
  'xiaolong_scholar', 'xiaolong_warrior', 'xiaolong_chef'
];

// 每日互动上限（防刷分）
const DAILY_LIMITS = { quiz: 3, observe: 2, homework: 1 };

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

  // 单个/批量新增
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
        'SELECT COALESCE(MAX(sort_order), 0) AS m FROM students WHERE class_id=$1', [classId]
      );
      let base = Number(maxRow[0].m) || 0;
      const inserted = [];
      for (const name of names) {
        base += 1;
        const { rows: r } = await client.query(
          `INSERT INTO students (class_id, name, sort_order, group_name)
           VALUES ($1, $2, $3, $4) RETURNING *`, [classId, name, base, groupName]
        );
        inserted.push(r[0]);
      }
      return inserted;
    });
    return reply.code(201).send({ students: rows });
  });

  // 改名 / 换伙伴 / 调整顺序 / 昵称主色 / 照料恢复（老师端操作）
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
    const sortOrder = req.body?.sort_order === undefined ? student.sort_order : Number(req.body.sort_order);
    const groupName = req.body?.group_name === undefined ? student.group_name
      : req.body.group_name === null ? null : assertText(req.body.group_name, '小组名', { max: 20 });
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

  // R45: 学生端认领伙伴 — 入班只带班级码，先选自己，认领后签发设备令牌
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

    // R45: 签发设备令牌
    const deviceToken = generateDeviceToken();

    const row = await queryOne(
      `UPDATE students SET partner_kind=$1, nickname=COALESCE($2, nickname), color=COALESCE($3, color),
              device_token=$4, device_token_at=now()
        WHERE id=$5 RETURNING *`,
      [kind, nickname, color, deviceToken, studentId]
    );
    if (!row) throw notFound('学生不存在');
    await query('INSERT INTO partner_claims (student_id, kind) VALUES ($1, $2)', [studentId, kind]);
    return { student: row, device_token: deviceToken };
  });

  // R45: 重新选自己（不自动恢复上次身份）
  fastify.post('/api/students/:id/select', async (req, reply) => {
    const studentId = assertUuid(req.params.id, 'id');
    const student = await queryOne('SELECT id, name, nickname, partner_kind, color, class_id FROM students WHERE id=$1', [studentId]);
    if (!student) throw notFound('学生不存在');
    // 不签发令牌，只是选定身份。认领/换伙伴时才签发
    return { student };
  });

  fastify.delete('/api/students/:id', auth, async (req, reply) => {
    const student = await assertOwnsStudent(req.user.sub, assertUuid(req.params.id, 'id'));
    await query('DELETE FROM students WHERE id=$1', [student.id]);
    return reply.code(204).send();
  });

  // R47: 学生答题 — 从服务端取题
  fastify.get('/api/students/:id/quiz/next', async (req, reply) => {
    const studentId = assertUuid(req.params.id, 'id');
    const student = await queryOne('SELECT * FROM students WHERE id=$1', [studentId]);
    if (!student) throw notFound('学生不存在');

    // 优先取班级专属题，其次取该年级通用题
    const { rows: questions } = await query(
      `SELECT * FROM questions
       WHERE is_active = true
         AND (class_id = $1 OR (class_id IS NULL AND (grade IS NULL OR grade = $2)))
       ORDER BY RANDOM() LIMIT 1`,
      [student.class_id, student.grade || null]
    );

    if (!questions.length) {
      return { question: null, message: '老师还没有录题，请稍后再来～' };
    }

    const q = questions[0];
    // 不返回 answer 字段
    return {
      question: {
        id: q.id,
        question: q.question,
        options: q.options,
        unit: q.unit
      }
    };
  });

  // R47: 学生提交答题 — 服务端判分
  fastify.post('/api/students/:id/quiz', async (req, reply) => {
    const studentId = assertUuid(req.params.id, 'id');
    const student = await queryOne('SELECT * FROM students WHERE id=$1', [studentId]);
    if (!student) throw notFound('学生不存在');

    // R45: 校验设备令牌
    await assertDeviceToken(req, studentId);

    const questionId = assertUuid(req.body?.question_id, 'question_id');
    const choice = req.body?.choice;
    if (typeof choice !== 'number' || !Number.isInteger(choice)) throw badRequest('choice 必须是整数');

    const q = await queryOne('SELECT * FROM questions WHERE id = $1 AND is_active = true', [questionId]);
    if (!q) throw notFound('题目不存在或已停用');

    // 服务端判分，不接受前端 correct 字段
    const correct = choice === q.answer;
    const points = correct ? 2 : 0;

    // 每日答题上限
    const { rows: todayQuiz } = await query(
      `SELECT COUNT(*)::INT AS n FROM student_activities
       WHERE student_id=$1 AND kind='quiz' AND created_at >= date_trunc('day', now())`,
      [studentId]
    );
    if (Number(todayQuiz[0].n) >= (DAILY_LIMITS.quiz)) {
      return { ...(await studentActivityView(student)), already: true, message: '今天已经答完题啦，明天再来～' };
    }

    await query(
      `INSERT INTO student_activities (class_id, student_id, kind, detail, correct, points)
       VALUES ($1,$2,'quiz',$3,$4,$5)`,
      [student.class_id, studentId, q.question, correct, points]
    );

    return reply.code(201).send({
      correct,
      points,
      explanation: q.explanation || null,
      answer: q.answer,
      ...(await studentActivityView(student))
    });
  });

  // 学生自主活动：签到 / 观察记录 / 作业（R45: 需设备令牌）
  fastify.post('/api/students/:id/activity', async (req, reply) => {
    const studentId = assertUuid(req.params.id, 'id');
    const student = await queryOne('SELECT * FROM students WHERE id=$1', [studentId]);
    if (!student) throw notFound('学生不存在');

    // R45: 校验设备令牌
    await assertDeviceToken(req, studentId);

    const kind = req.body?.kind;
    const ALLOWED = ['checkin', 'observe', 'homework'];
    if (!ALLOWED.includes(kind)) throw badRequest('kind 非法');

    const detail = req.body?.detail ? assertText(req.body.detail, '内容', { max: 200 }) : null;

    // 服务端定分
    let points = 0;
    if (kind === 'checkin') points = 1;
    else if (kind === 'observe') points = 1;
    else if (kind === 'homework') points = 3;

    // 签到限日一次
    if (kind === 'checkin') {
      const { rows } = await query(
        `SELECT 1 FROM student_activities WHERE student_id=$1 AND kind='checkin'
         AND created_at >= date_trunc('day', now()) LIMIT 1`,
        [studentId]
      );
      if (rows.length) return { ...(await studentActivityView(student)), already: true, message: '今天已经签到啦' };
    }

    // 观察每日上限
    if (kind === 'observe') {
      const { rows } = await query(
        `SELECT COUNT(*)::INT AS n FROM student_activities WHERE student_id=$1 AND kind='observe'
         AND created_at >= date_trunc('day', now())`,
        [studentId]
      );
      if (Number(rows[0].n) >= DAILY_LIMITS.observe)
        return { ...(await studentActivityView(student)), already: true, message: '今天观察记录已达上限，明天再来～' };
    }

    // 作业每日上限
    if (kind === 'homework') {
      const { rows } = await query(
        `SELECT COUNT(*)::INT AS n FROM student_activities WHERE student_id=$1 AND kind='homework'
         AND created_at >= date_trunc('day', now())`,
        [studentId]
      );
      if (Number(rows[0].n) >= DAILY_LIMITS.homework)
        return { ...(await studentActivityView(student)), already: true, message: '今天作业已提交，等老师批改～' };
    }

    if (points > 0) {
      await query(
        `INSERT INTO student_activities (class_id, student_id, kind, detail, correct, points)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [student.class_id, studentId, kind, detail, null, points]
      );
    }
    return reply.code(201).send(await studentActivityView(student));
  });

  // 查询某学生的活动与成长值
  fastify.get('/api/students/:id/activities', async (req) => {
    const studentId = assertUuid(req.params.id, 'id');
    const student = await queryOne('SELECT * FROM students WHERE id=$1', [studentId]);
    if (!student) throw notFound('学生不存在');
    return studentActivityView(student);
  });

  // R46: 学生申请换伙伴（需老师授权）
  fastify.post('/api/students/:id/partner-change', async (req, reply) => {
    const studentId = assertUuid(req.params.id, 'id');
    const student = await queryOne('SELECT * FROM students WHERE id=$1', [studentId]);
    if (!student) throw notFound('学生不存在');

    const requestedKind = req.body?.requested_kind;
    if (!requestedKind || !PARTNER_KINDS.includes(requestedKind)) throw badRequest('partner_kind 非法');

    const row = await queryOne(
      `INSERT INTO partner_change_requests (student_id, class_id, current_kind, requested_kind)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [studentId, student.class_id, student.partner_kind, requestedKind]
    );
    return reply.code(201).send({ request: row, message: '换伙伴申请已提交，请老师授权后生效～' });
  });
}

async function studentActivityView(student) {
  const { rows } = await query(
    `SELECT kind, detail, correct, points, created_at
       FROM student_activities WHERE student_id=$1 ORDER BY created_at DESC LIMIT 50`,
    [student.id]
  );
  const { rows: sum } = await query(
    'SELECT COALESCE(SUM(points),0)::INT AS total FROM student_activities WHERE student_id=$1',
    [student.id]
  );
  const { rows: today } = await query(
    `SELECT COALESCE(SUM(points),0)::INT AS t FROM student_activities
       WHERE student_id=$1 AND created_at >= date_trunc('day', now())`,
    [student.id]
  );
  return {
    student: {
      id: student.id,
      name: student.name,
      nickname: student.nickname,
      partner_kind: student.partner_kind,
      color: student.color
    },
    totalPoints: Number(sum[0].total),
    todayPoints: Number(today[0].t),
    activities: rows.map((r) => ({ kind: r.kind, detail: r.detail, correct: r.correct, points: r.points, created_at: r.created_at }))
  };
}
