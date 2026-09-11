import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';

import { healthCheck, pool } from './db.js';
import authRoutes from './routes/auth.js';
import classRoutes from './routes/classes.js';
import studentRoutes from './routes/students.js';
import eventRoutes from './routes/events.js';

const PORT = Number(process.env.PORT || 3100);
const HOST = process.env.HOST || '0.0.0.0';
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET || JWT_SECRET.length < 16) {
  console.error('[fatal] 未设置 JWT_SECRET 或长度不足 16 位，请在 .env 中配置');
  process.exit(1);
}

const app = Fastify({
  logger: { level: process.env.LOG_LEVEL || 'info' },
  trustProxy: true,
  bodyLimit: 256 * 1024
});

await app.register(cors, { origin: true, credentials: true });
await app.register(jwt, { secret: JWT_SECRET, sign: { expiresIn: process.env.JWT_EXPIRES_IN || '30d' } });

// 容忍「声明 application/json 但空 body」的请求（例如没有 body 的 DELETE）。
// Fastify 默认会对此抛 400（FST_ERR_CTP_EMPTY_JSON_BODY），导致「删除学生」等无 body 请求失败。
app.removeContentTypeParser('application/json');
app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
  if (body === undefined || body === null || body === '') return done(null, undefined);
  try {
    done(null, JSON.parse(body));
  } catch (err) {
    err.statusCode = 400; // 真正的非法 JSON 仍返回 400
    done(err);
  }
});

app.decorate('authenticate', async (req, reply) => {
  try {
    await req.jwtVerify();
  } catch (err) {
    // 必须 return，否则钩子放行后处理器仍会执行、取 req.user 抛错变成 500
    return reply.code(401).send({ error: '未登录或登录已失效' });
  }
});

app.get('/api/health', async () => {
  const dbOk = await healthCheck().catch(() => false);
  return { ok: dbOk, service: 'growth-planet-api', time: new Date().toISOString() };
});

await app.register(authRoutes);
await app.register(classRoutes);
await app.register(studentRoutes);
await app.register(eventRoutes);

app.setNotFoundHandler((req, reply) => reply.code(404).send({ error: `接口不存在: ${req.method} ${req.url}` }));
app.setErrorHandler((err, req, reply) => {
  const status = err.statusCode || 500;
  if (status >= 500) req.log.error({ err, url: req.url }, '服务端错误');
  reply.code(status).send({ error: err.message || '服务器内部错误' });
});

const shutdown = async (signal) => {
  app.log.info(`收到 ${signal}，正在关闭…`);
  try {
    await app.close();
    await pool.end();
    process.exit(0);
  } catch (err) {
    console.error('关闭失败:', err);
    process.exit(1);
  }
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

try {
  await app.listen({ port: PORT, host: HOST });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
