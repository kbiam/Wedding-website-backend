const mysql = require('mysql2/promise');
require('dotenv').config();

// Create a function to set up the connection pool with retry logic
function createPool() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || 'tramway.proxy.rlwy.net',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'password',
    database: process.env.DB_NAME || 'wedding_management',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    port: process.env.DB_PORT || 3306,
    // Add connection timeout settings
    connectTimeout: 20000, // 20 seconds
    acquireTimeout: 30000, // 30 seconds
  });

  console.log(`[MySQL] Attempting to connect to ${process.env.DB_HOST || 'tramway.proxy.rlwy.net'}`);
  
  return pool;
}

const pool = createPool();
 
// Create a wrapper function to handle retries for queries
async function executeQuery(queryFn, maxRetries = 3) {
  let lastError;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await queryFn(pool);
    } catch (error) {
      lastError = error;
      
      // Only retry on connection-related errors
      if (!['ETIMEDOUT', 'ENOTFOUND', 'ECONNREFUSED', 'PROTOCOL_CONNECTION_LOST'].includes(error.code)) {
        throw error; // Don't retry for query syntax errors, etc.
      }
      
      console.log(`[MySQL] Connection attempt ${attempt} failed: ${error.message}. Retrying in 2 seconds...`);
      
      if (attempt < maxRetries) {
        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
  }
  
  // If we got here, all retries failed
  console.error(`[MySQL] All connection attempts failed after ${maxRetries} retries`);
  throw lastError;
}

module.exports = { 
  pool,
  query: async (sql, params) => executeQuery(async (p) => p.query(sql, params)),
  getConnection: async () => executeQuery(async (p) => p.getConnection())
};