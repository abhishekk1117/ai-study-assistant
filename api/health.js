const { loadStore } = require('./lib/storage');

module.exports = async (req, res) => {
  try {
    const store = await loadStore();
    res.status(200).json({ 
      status: 'ok', 
      chunksIndexed: store.chunks.length 
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
