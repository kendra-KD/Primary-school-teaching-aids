import pg from 'pg';

const { Pool } = pg;

export const pool = new Pool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME || 'growth_planet',
  user: process.env.DB_USER || 'gp_app',
  password: process.env.DB_PASSWORD,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000
});

pool.on('error', (err) => {
  console.error('[db] 连接池异常:', err.message);
});

export async function query(text, params) {
  const start = Date.now();
  try {
    return await pool.query(text, params);
  } finally {
    const cost = Date.now() - start;
    if (cost > 500) console.warn(`[db] 慢查询 ${cost}ms: ${text.slice(0, 80)}`);
  }
}

export async function queryOne(text, params) {
  const { rows } = await query(text, params);
  return rows[0] || null;
}

export async function withTx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function healthCheck() {
  const { rows } = await query('SELECT 1 AS ok');
  return rows[0]?.ok === 1;
}
