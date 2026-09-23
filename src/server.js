const express = require('express');
const cors = require('cors');
const path = require('path');
const os = require('os');
require('dotenv').config();

const initDatabase = require('./scripts/initDb');
const authRoutes = require('./routes/auth');
const studentRoutes = require('./routes/students');
const sessionRoutes = require('./routes/sessions');
const attendanceRoutes = require('./routes/attendance');
const reportRoutes = require('./routes/reports');
const userRoutes = require('./routes/users');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve frontend static files
app.use(express.static(path.join(__dirname, '../public')));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/students', studentRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/users', userRoutes);

// Catch-all fallback for single-page app frontend routing
app.use((req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Helper to get local network IP address (for mobile phone connection)
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

// Start server
async function startServer() {
  try {
    await initDatabase();
    
    app.listen(PORT, '0.0.0.0', () => {
      const localIP = getLocalIP();
      console.log('====================================================');
      console.log('  Sunday School Attendance Management System');
      console.log('====================================================');
      console.log(`  Local Computer:    http://localhost:${PORT}`);
      console.log(`  Mobile on Wi-Fi:   http://${localIP}:${PORT}`);
      console.log('====================================================');
      console.log('  Default Accounts:');
      console.log('    Admin:    username: admin   | password: admin123');
      console.log('    Encoder:  username: encoder | password: encoder123');
      console.log('====================================================');
    });
  } catch (error) {
    console.error('Server failed to start:', error);
  }
}

startServer();
