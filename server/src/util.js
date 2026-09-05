import { queryOne } from './db.js';

export function httpError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

export const badRequest = (msg = '请求参数有误') => httpError(400, msg);
export const unauthorized = (msg = '未登录或登录已失效') => httpError(401, msg);
export const forbidden = (msg = '无权访问该资源') => httpError(403, msg);
export const notFound = (msg = '资源不存在') => httpError(404, msg);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function assertUuid(value, field = 'id') {
  if (typeof value !== 'string' || !UUID_RE.test(value)) {
    throw badRequest(`${field} 不是合法 UUID`);
  }
  return value;
}

export function assertText(value, field, { max = 60, min = 1 } = {}) {
  if (typeof value !== 'string') throw badRequest(`${field} 必须是字符串`);
  const v = value.trim();
  if (v.length < min) throw badRequest(`${field} 不能为空`);
  if (v.length > max) throw badRequest(`${field} 长度不能超过 ${max}`);
  return v;
}

export function assertInt(value, field, { min, max } = {}) {
  const n = Number(value);
  if (!Number.isInteger(n)) throw badRequest(`${field} 必须是整数`);
  if (min !== undefined && n < min) throw badRequest(`${field} 不能小于 ${min}`);
  if (max !== undefined && n > max) throw badRequest(`${field} 不能大于 ${max}`);
  return n;
}

/** 校验班级归属当前老师，返回班级行 */
export async function assertOwnsClass(teacherId, classId) {
  assertUuid(classId, 'class_id');
  const row = await queryOne('SELECT * FROM classes WHERE id = $1 AND teacher_id = $2', [classId, teacherId]);
  if (!row) throw notFound('班级不存在或无权访问');
  return row;
}

/** 校验学生归属当前老师（经班级间接校验），返回 { student, class_id } */
export async function assertOwnsStudent(teacherId, studentId) {
  assertUuid(studentId, 'student_id');
  const row = await queryOne(
    `SELECT s.*, c.id AS class_id
       FROM students s
       JOIN classes c ON c.id = s.class_id
      WHERE s.id = $1 AND c.teacher_id = $2`,
    [studentId, teacherId]
  );
  if (!row) throw notFound('学生不存在或无权访问');
  return row;
}
