/**
 * Обёртка над Upstash Redis (REST, бесплатный тариф — 10k команд/день).
 * Serverless-функции Vercel не имеют общего диска между вызовами,
 * поэтому вместо fs.writeFileSync (как было в локальной версии) —
 * храним токены здесь.
 *
 * Установка:
 *   1. Зарегистрируйся на https://upstash.com (бесплатно)
 *   2. Создай Redis-базу (ближайший регион к твоему Vercel-деплою)
 *   3. Скопируй UPSTASH_REDIS_REST_URL и UPSTASH_REDIS_REST_TOKEN
 *      в переменные окружения проекта на Vercel (Settings → Environment Variables)
 *   4. npm install @upstash/redis
 */
const { Redis } = require('@upstash/redis');

const redis = Redis.fromEnv();

async function kvGet(key) {
  return await redis.get(key); // @upstash/redis сам парсит JSON
}

async function kvSet(key, value, ttlSeconds) {
  if (ttlSeconds) return await redis.set(key, value, { ex: ttlSeconds });
  return await redis.set(key, value);
}

async function kvDel(key) {
  return await redis.del(key);
}

module.exports = { kvGet, kvSet, kvDel };
