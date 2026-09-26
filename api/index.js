const app = require('../src/server');
const initDatabase = require('../src/scripts/initDb');

let isInitialized = false;
let initPromise = null;

module.exports = async (req, res) => {
  if (!isInitialized) {
    if (!initPromise) {
      initPromise = initDatabase()
        .then(() => {
          isInitialized = true;
          return true;
        })
        .catch(e => {
          initPromise = null;
          console.error('Serverless database auto-initialization error:', e);
          res.status(500).json({
            message: `Database Connection Error: ${e.message || e}. Please check DB_HOST, DB_USER, DB_PASSWORD environment variables.`
          });
          return false;
        });
    }
    const success = await initPromise;
    if (success === false) return;
  }
  return app(req, res);
};
