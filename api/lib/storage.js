const fs = require('fs/promises');
const path = require('path');
const { Redis } = require('@upstash/redis');

const STORAGE_FILE = path.join(process.cwd(), 'rag-store.json');
const STORAGE_KEY = 'ragStore';
let redisClient = null;

function hasRedisConfig() {
  return Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}

function isVercelRuntime() {
  return process.env.VERCEL === '1';
}

function getRedisClient() {
  if (!redisClient) {
    redisClient = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
  }
  return redisClient;
}

async function loadStore() {
  if (hasRedisConfig()) {
    const store = await getRedisClient().get(STORAGE_KEY);
    return store && Array.isArray(store.chunks) ? store : { chunks: [] };
  }

  if (isVercelRuntime()) {
    throw new Error(
      'Persistent storage is not configured. Connect Upstash Redis and set UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN.',
    );
  }

  try {
    const data = await fs.readFile(STORAGE_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return { chunks: [] };
  }
}

async function saveStore(store) {
  if (hasRedisConfig()) {
    await getRedisClient().set(STORAGE_KEY, store);
    return;
  }

  if (isVercelRuntime()) {
    throw new Error(
      'Persistent storage is not configured. Connect Upstash Redis and set UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN.',
    );
  }

  try {
    await fs.writeFile(STORAGE_FILE, JSON.stringify(store, null, 2));
  } catch (error) {
    throw new Error(`Failed to save local store: ${error.message}`);
  }
}

module.exports = { loadStore, saveStore };
