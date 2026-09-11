import { queryOne, query } from './db.js';
import { unauthorized, forbidden, badRequest } from './util.js';
import { randomUUID } from 'crypto';

/**
 * R45: 验证学生设备令牌
 * 请求头 X-Device-Token 或 body.device_token
 * 返回 student 行，含 class_id
 */
export async function assertDeviceToken(req, studentId) {
  const token = req.headers['x-device-token'] || req.body?.device_token;
  if (!token) throw unauthorized('缺少设备令牌，请重新认领伙伴');

  const student = await queryOne(
    `SELECT * FROM students WHERE id = $1 AND device_token = $2`,
    [studentId, token]
  );
  if (!student) throw unauthorized('设备令牌无效，请重新认领伙伴');
  return student;
}

/**
 * R51: 验证授课会话令牌
 * 请求头 X-Lesson-Token 或 body.lesson_token
 * 返回 lesson_session 行，含 teacher_id / class_id
 */
export async function assertLessonSession(req, classId) {
  const token = req.headers['x-lesson-token'] || req.body?.lesson_token;
  if (!token) throw forbidden('当前没有正在进行的授课会话，请先「开始上课」');

  // 检查会话是否存在且有效
  const session = await queryOne(
    `SELECT * FROM lesson_sessions
     WHERE id = $1 AND active = true
       AND (ended_at IS NULL)
       AND (expires_at IS NULL OR expires_at > now())`,
    [token]
  );
  if (!session) throw forbidden('授课会话已结束或已过期，请重新「开始上课」');

  // 会话的 class_id 必须与操作的 class_id 匹配
  if (classId && session.class_id !== classId) {
    throw forbidden('当前授课会话不属于此班级');
  }

  // 验证请求者身份（JWT 中的 teacher_id 必须与会话发起者一致）
  if (req.user && req.user.sub !== session.teacher_id) {
    throw forbidden('无权使用此授课会话');
  }

  return session;
}

/**
 * R49: 获取老师当前活跃的授课会话
 */
export async function getActiveLesson(teacherId) {
  return queryOne(
    `SELECT * FROM lesson_sessions
     WHERE teacher_id = $1 AND active = true AND ended_at IS NULL
       AND (expires_at IS NULL OR expires_at > now())
     ORDER BY started_at DESC LIMIT 1`,
    [teacherId]
  );
}

/**
 * 生成随机 4 位 PIN
 */
export function generatePin() {
  return String(Math.floor(Math.random() * 9000) + 1000);
}

/**
 * 生成随机设备令牌（crypto.randomUUID，Node 22 内置）
 */
export function generateDeviceToken() {
  return randomUUID();
}
