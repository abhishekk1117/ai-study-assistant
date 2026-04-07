const fs = require('fs/promises');
const path = require('path');

const STORAGE_FILE = path.join(process.cwd(), 'rag-store.json');
const STORAGE_KEY = 'ragStore';
let redisClient = null;
let inMemoryStore = { chunks: [] };

function hasRedisConfig() {
  return Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}

function getRedisClient() {
  if (!redisClient && hasRedisConfig()) {
    const { Redis } = require('@upstash/redis');
    redisClient = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
  }
  return redisClient;
}

async function loadStore() {
  // Try Redis first if configured
  if (hasRedisConfig()) {
    try {
      const redis = getRedisClient();
      const store = await redis.get(STORAGE_KEY);
      return store && Array.isArray(store.chunks) ? store : { chunks: [] };
    } catch (error) {
      console.warn('Redis load failed, falling back:', error.message);
    }
  }

  // Try local file
  try {
    const data = await fs.readFile(STORAGE_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    // Return in-memory fallback
    return inMemoryStore;
  }
}

async function saveStore(store) {
  // Update in-memory store always
  inMemoryStore = store;

  // Try Redis if configured
  if (hasRedisConfig()) {
    try {
      const redis = getRedisClient();
      await redis.set(STORAGE_KEY, store);
      return;
    } catch (error) {
      console.warn('Redis save failed, falling back to local:', error.message);
    }
  }

  // Try local file
  try {
    await fs.writeFile(STORAGE_FILE, JSON.stringify(store, null, 2));
  } catch (error) {
    console.warn('Local file save failed, data in memory only:', error.message);
    // Don't throw - keep data in memory
  }
}

module.exports = { loadStore, saveStore };
