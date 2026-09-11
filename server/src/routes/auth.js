import bcrypt from 'bcryptjs';
import { query, queryOne } from '../db.js';
import { badRequest, unauthorized } from '../util.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function publicTeacher(row) {
  return { id: row.id, email: row.email, display_name: row.display_name, created_at: row.created_at };
}

export default async function authRoutes(fastify) {
  // 注册：生产环境建议关闭（ALLOW_REGISTER=false），改用 scripts/create-teacher.js 建号
  fastify.post('/api/auth/register', async (req, reply) => {
    if (process.env.ALLOW_REGISTER === 'false') throw badRequest('注册已关闭，请联系管理员开通账号');

    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const displayName = String(req.body?.display_name || '').trim();

    if (!EMAIL_RE.test(email)) throw badRequest('邮箱格式不正确');
    if (password.length < 8) throw badRequest('密码至少 8 位');
    if (password.length > 128) throw badRequest('密码过长');

    const exists = await queryOne('SELECT id FROM teachers WHERE email = $1', [email]);
    if (exists) throw badRequest('该邮箱已注册');

    const hash = await bcrypt.hash(password, 10);
    const row = await queryOne(
      `INSERT INTO teachers (email, password_hash, display_name)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [email, hash, displayName || '科学老师']
    );

    const token = fastify.jwt.sign({ sub: row.id, email: row.email });
    return reply.code(201).send({ token, teacher: publicTeacher(row) });
  });

  fastify.post('/api/auth/login', async (req, reply) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    if (!email || !password) throw badRequest('请输入邮箱和密码');

    const row = await queryOne('SELECT * FROM teachers WHERE email = $1', [email]);
    // 恒定耗时比较，避免通过响应时间枚举账号
    const hash = row?.password_hash || '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidiu';
    const ok = await bcrypt.compare(password, hash);
    if (!row || !ok) throw unauthorized('邮箱或密码不正确');

    const token = fastify.jwt.sign({ sub: row.id, email: row.email });
    return reply.send({ token, teacher: publicTeacher(row) });
  });

  fastify.get('/api/me', { onRequest: [fastify.authenticate] }, async (req) => {
    const row = await queryOne('SELECT * FROM teachers WHERE id = $1', [req.user.sub]);
    if (!row) throw unauthorized('账号不存在');
    return { teacher: publicTeacher(row) };
  });

  // R48: 我的带班记录（班级 + 学生数 + 最近活动数）
  fastify.get('/api/me/classes', { onRequest: [fastify.authenticate] }, async (req) => {
    const { rows: classes } = await query(
      `SELECT c.*,
        (SELECT COUNT(*)::INT FROM students s WHERE s.class_id = c.id) AS student_count,
        (SELECT COUNT(*)::INT FROM student_activities sa WHERE sa.class_id = c.id) AS activity_count,
        (SELECT MAX(created_at) FROM student_activities sa WHERE sa.class_id = c.id) AS last_activity_at
       FROM classes c
       WHERE c.teacher_id = $1
       ORDER BY c.created_at DESC`,
      [req.user.sub]
    );
    return { classes };
  });
}
