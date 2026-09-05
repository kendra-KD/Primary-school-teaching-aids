#!/usr/bin/env node
// 创建/重置老师账号（生产环境关闭注册后用这个建号）
// 用法：node scripts/create-teacher.js teacher@school.edu 密码 显示名
//      DB_* 环境变量同 .env，可用 `set -a; . .env; set +a` 加载

import bcrypt from 'bcryptjs';
import { queryOne, pool } from '../src/db.js';

const [email, password, displayName] = process.argv.slice(2);

if (!email || !password) {
  console.error('用法: node scripts/create-teacher.js <email> <password> [display_name]');
  process.exit(1);
}
if (password.length < 8) {
  console.error('密码至少 8 位');
  process.exit(1);
}

async function main() {
  const hash = await bcrypt.hash(password, 10);
  const row = await queryOne(
    `INSERT INTO teachers (email, password_hash, display_name)
     VALUES ($1, $2, $3)
     ON CONFLICT (email) DO UPDATE
        SET password_hash = EXCLUDED.password_hash,
            display_name  = EXCLUDED.display_name
     RETURNING id, email, display_name`,
    [email.toLowerCase(), hash, displayName || '科学老师']
  );
  console.log('账号就绪:', row);
}

main()
  .catch((err) => {
    console.error('创建失败:', err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
