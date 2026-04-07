const fs = require('fs/promises');
const path = require('path');

const STORAGE_FILE = path.join(process.cwd(), 'rag-store.json');

async function loadStore() {
  try {
    const data = await fs.readFile(STORAGE_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return { chunks: [] };
  }
}

async function saveStore(store) {
  try {
    await fs.writeFile(STORAGE_FILE, JSON.stringify(store, null, 2));
  } catch (error) {
    console.error('Failed to save store:', error);
  }
}

module.exports = { loadStore, saveStore };
