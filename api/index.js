const app = require('../src/server');
const initDatabase = require('../src/scripts/initDb');

let isInitialized = false;

module.exports = async (req, res) => {
  if (!isInitialized) {
    try {
      await initDatabase();
      isInitialized = true;
    } catch (e) {
      console.error('Serverless database auto-initialization error:', e);
    }
  }
  return app(req, res);
};
