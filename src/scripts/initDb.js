const bcrypt = require('bcryptjs');
const pool = require('../config/db');

async function initDatabase() {
  console.log('Connecting to PostgreSQL database and initializing tables...');

  try {
    // 1. Users Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        full_name VARCHAR(100) NOT NULL,
        role VARCHAR(20) DEFAULT 'encoder' CHECK (role IN ('super_admin', 'admin', 'encoder')),
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Migrate users_role_check constraint if table was created previously with older allowed roles
    try {
      await pool.query(`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;`);
      await pool.query(`ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('super_admin', 'admin', 'encoder'));`);
    } catch (err) {
      console.log('Constraint update notice:', err.message);
    }

    // 2. Students Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS students (
        id SERIAL PRIMARY KEY,
        first_name VARCHAR(100) NOT NULL,
        father_name VARCHAR(100) NOT NULL,
        mother_name VARCHAR(100) NOT NULL,
        christian_name VARCHAR(100) DEFAULT '',
        age INT NOT NULL,
        phone VARCHAR(25) NOT NULL,
        emergency_contact VARCHAR(50) DEFAULT '',
        profession VARCHAR(100) DEFAULT '',
        previous_service VARCHAR(150) DEFAULT '',
        category VARCHAR(50) NOT NULL,
        status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
    `);

    try {
      await pool.query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS christian_name VARCHAR(100) DEFAULT '';`);
    } catch (err) {
      console.log('Students christian_name column migration notice:', err.message);
    }

    // 3. Sessions Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        id SERIAL PRIMARY KEY,
        course_title VARCHAR(150) NOT NULL,
        session_date DATE NOT NULL,
        session_time VARCHAR(50) NOT NULL,
        start_time VARCHAR(10) DEFAULT '09:00',
        end_time VARCHAR(10) DEFAULT '11:00',
        category VARCHAR(50) NOT NULL,
        description TEXT,
        created_by INT REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
    `);

    try {
      await pool.query(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS start_time VARCHAR(10) DEFAULT '09:00';`);
      await pool.query(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS end_time VARCHAR(10) DEFAULT '11:00';`);
    } catch (err) {
      console.log('Sessions migration notice:', err.message);
    }

    // 4. Attendance Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS attendance (
        id SERIAL PRIMARY KEY,
        session_id INT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        student_id INT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
        status VARCHAR(20) NOT NULL CHECK (status IN ('present', 'absent', 'permission')),
        remarks VARCHAR(255) DEFAULT '',
        marked_by INT REFERENCES users(id) ON DELETE SET NULL,
        timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uniq_session_student UNIQUE (session_id, student_id)
      );
    `);

    // 5. Performance Indexes
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_students_category_status ON students(category, status);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_students_status ON students(status);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_students_first_name ON students(first_name);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_attendance_session_student ON attendance(session_id, student_id);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_attendance_student_status ON attendance(student_id, status);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_attendance_session_id ON attendance(session_id);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_sessions_date ON sessions(session_date);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_sessions_category_date ON sessions(category, session_date);`);

    console.log('Tables and indexes verified and ready.');

    // Seed default superadmin, admin, and encoder accounts individually if missing
    const defaultUsers = [
      { username: 'superadmin', password: 'superadmin1219', full_name: 'Sunday School Super Admin', role: 'super_admin' },
      { username: 'admin', password: 'admin123', full_name: 'Sunday School Admin', role: 'admin' },
      { username: 'encoder', password: 'encoder123', full_name: 'Sunday School Encoder', role: 'encoder' }
    ];

    for (const u of defaultUsers) {
      const [userRows] = await pool.query('SELECT id FROM users WHERE username = ?', [u.username]);
      if (userRows.length === 0) {
        const hash = await bcrypt.hash(u.password, 10);
        await pool.query(
          'INSERT INTO users (username, password_hash, full_name, role) VALUES (?, ?, ?, ?)',
          [u.username, hash, u.full_name, u.role]
        );
        console.log(`Default account created -> username: ${u.username}, role: ${u.role}`);
      } else if (u.username === 'superadmin') {
        const hash = await bcrypt.hash(u.password, 10);
        await pool.query(
          'UPDATE users SET password_hash = ? WHERE username = ?',
          [hash, u.username]
        );
        console.log(`Superadmin password updated to superadmin1219.`);
      }
    }

    // Seed initial sample students if empty for quick testing
    const [existingStudents] = await pool.query('SELECT id FROM students LIMIT 1');
    if (existingStudents.length === 0) {
      console.log('Seeding sample Sunday School students (Amharic & English)...');
      await pool.query(`
        INSERT INTO students (first_name, father_name, mother_name, age, phone, emergency_contact, profession, previous_service, category, status) VALUES
        ('ዳዊት (Dawit)', 'ዮሐንስ (Yohannes)', 'ማርታ (Marta)', 22, '0911223344', '0922334455 (ወላጅ)', 'ዩኒቨርሲቲ ተማሪ', 'የዝማሬ ክፍል', 'Youth', 'active'),
        ('ሰላማዊት (Selamawit)', 'ተስፋዬ (Tesfaye)', 'ወለተ (Welete)', 19, '0912345678', '0911445566 (እናት)', 'ተማሪ', 'አዲስ', 'Youth', 'active'),
        ('ዮናስ (Yonas)', 'ከበደ (Kebede)', 'ትርሲት (Tirsit)', 10, '0933445566', '0933112233 (አባት)', '5ኛ ክፍል', 'የህፃናት መዝሙር', 'Child', 'active'),
        ('ሄለን (Helen)', 'ግርማ (Girma)', 'ብርቱካን (Birtukan)', 11, '0944556677', '0944001122 (እናት)', '6ኛ ክፍል', 'የህፃናት ክፍል', 'Child', 'active'),
        ('ሚካኤል (Mikael)', 'ኃይሌ (Haile)', 'አልማዝ (Almaz)', 16, '0955667788', '0955998877 (አባት)', '10ኛ ክፍል', 'ስርዓተ ቤተክርስቲያን', 'Teens', 'active'),
        ('ብርሃኑ (Berhanu)', 'ታደሰ (Tadesse)', 'ሰናይት (Senait)', 35, '0966778899', '0966112200 (ባለቤት)', 'መምህር', 'የስብከት ክፍል', 'Adult', 'active')
      `);
      console.log('Sample students added.');
    }

    console.log('Database initialization completed successfully!');
  } catch (error) {
    console.error('Database initialization error:', error);
    if (require.main === module) {
      process.exit(1);
    }
    throw error;
  }
}

if (require.main === module) {
  initDatabase().then(() => pool.pool.end());
}

module.exports = initDatabase;
