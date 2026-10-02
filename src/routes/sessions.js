const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { logActivity } = require('../utils/auditLogger');

// Helper to generate recurring dates
function generateSessionDates(startDateStr, recurrence) {
  if (!recurrence || !recurrence.type || recurrence.type === 'none') {
    return [startDateStr];
  }

  const type = recurrence.type; // 'weekly', 'monthly', 'custom'
  if (type === 'custom' && Array.isArray(recurrence.custom_dates) && recurrence.custom_dates.length > 0) {
    const set = new Set([startDateStr, ...recurrence.custom_dates.map(d => (d || '').trim()).filter(Boolean)]);
    return Array.from(set).sort();
  }

  const count = Math.max(1, Math.min(52, parseInt(recurrence.count, 10) || 1));
  const dates = [];
  const [sYear, sMonth, sDay] = startDateStr.split('-').map(Number);

  for (let i = 0; i < count; i++) {
    if (type === 'weekly') {
      const d = new Date(Date.UTC(sYear, sMonth - 1, sDay + (i * 7)));
      dates.push(d.toISOString().split('T')[0]);
    } else if (type === 'monthly') {
      const d = new Date(Date.UTC(sYear, sMonth - 1 + i, sDay));
      dates.push(d.toISOString().split('T')[0]);
    } else {
      dates.push(startDateStr);
      break;
    }
  }

  return Array.from(new Set(dates)).sort();
}

// GET /api/sessions - List sessions with attendance summary (with optional pagination)
router.get('/', authenticateToken, async (req, res) => {
  const { category, page, limit } = req.query;

  try {
    let baseQuery = `
      FROM sessions s
      LEFT JOIN users u ON s.created_by = u.id
      LEFT JOIN (
        SELECT 
          se.session_id,
          json_agg(json_build_object('id', u_enc.id, 'username', u_enc.username, 'full_name', u_enc.full_name) ORDER BY u_enc.full_name ASC) AS assigned_encoders
        FROM session_encoders se
        JOIN users u_enc ON se.user_id = u_enc.id
        GROUP BY se.session_id
      ) encs ON s.id = encs.session_id
      LEFT JOIN (
        SELECT 
          session_id,
          COUNT(CASE WHEN status = 'present' THEN 1 END) AS present_count,
          COUNT(CASE WHEN status = 'absent' THEN 1 END) AS absent_count,
          COUNT(CASE WHEN status = 'permission' THEN 1 END) AS permission_count,
          COUNT(*) AS total_marked
        FROM attendance
        GROUP BY session_id
      ) att ON s.id = att.session_id
      WHERE 1=1
    `;
    const params = [];

    // If encoder, only show sessions where they are assigned (or legacy open)
    if (req.user.role === 'encoder') {
      baseQuery += ` AND (
        EXISTS (SELECT 1 FROM session_encoders se WHERE se.session_id = s.id AND se.user_id = ?)
        OR s.assigned_encoder_id = ?
        OR (s.assigned_encoder_id IS NULL AND NOT EXISTS (SELECT 1 FROM session_encoders se WHERE se.session_id = s.id) AND s.created_by = ?)
      )`;
      params.push(req.user.id, req.user.id, req.user.id);
    }

    if (category && category !== 'All') {
      baseQuery += " AND (s.category = ? OR s.category = 'All')";
      params.push(category);
    }

    let selectQuery = `
      SELECT 
        s.id,
        s.course_title,
        s.session_date,
        s.session_time,
        s.start_time,
        s.end_time,
        s.category,
        s.description,
        s.assigned_encoder_id,
        COALESCE(encs.assigned_encoders, '[]'::json) AS assigned_encoders,
        COALESCE(s.attendance_status, CASE WHEN COALESCE(att.total_marked, 0) > 0 THEN 'finalized' ELSE 'unrecorded' END) AS attendance_status,
        s.created_by,
        s.created_at,
        u.full_name AS created_by_name,
        COALESCE(att.present_count, 0) AS present_count,
        COALESCE(att.absent_count, 0) AS absent_count,
        COALESCE(att.permission_count, 0) AS permission_count,
        COALESCE(att.total_marked, 0) AS total_marked
      ${baseQuery}
      ORDER BY s.session_date DESC, s.session_time DESC
    `;

    if (limit && !isNaN(parseInt(limit, 10))) {
      const pageNum = Math.max(1, parseInt(page, 10) || 1);
      const limitNum = Math.max(1, Math.min(200, parseInt(limit, 10)));
      const offset = (pageNum - 1) * limitNum;
      
      const countParams = [...params];
      const [[{ total }]] = await pool.query(`SELECT COUNT(s.id) AS total ${baseQuery}`, countParams);
      
      selectQuery += ` LIMIT ${limitNum} OFFSET ${offset}`;
      const [sessions] = await pool.query(selectQuery, params);
      
      return res.json({
        sessions,
        total: parseInt(total, 10),
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(parseInt(total, 10) / limitNum)
      });
    }

    const [sessions] = await pool.query(selectQuery, params);
    res.json(sessions);
  } catch (error) {
    console.error('Fetch sessions error:', error);
    res.status(500).json({ message: `Error retrieving sessions: ${error.message}` });
  }
});

// GET /api/sessions/:id - Get single session
router.get('/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;

  try {
    const [sessions] = await pool.query(`
      SELECT s.*, u.full_name AS created_by_name,
        COALESCE(encs.assigned_encoders, '[]'::json) AS assigned_encoders
      FROM sessions s
      LEFT JOIN users u ON s.created_by = u.id
      LEFT JOIN (
        SELECT 
          se.session_id,
          json_agg(json_build_object('id', u_enc.id, 'username', u_enc.username, 'full_name', u_enc.full_name) ORDER BY u_enc.full_name ASC) AS assigned_encoders
        FROM session_encoders se
        JOIN users u_enc ON se.user_id = u_enc.id
        GROUP BY se.session_id
      ) encs ON s.id = encs.session_id
      WHERE s.id = ?
    `, [id]);

    if (sessions.length === 0) {
      return res.status(404).json({ message: 'Session not found' });
    }

    const session = sessions[0];
    if (req.user.role === 'encoder') {
      const encList = Array.isArray(session.assigned_encoders) ? session.assigned_encoders : [];
      const isDirectlyAssigned = encList.some(e => e.id === req.user.id) || (session.assigned_encoder_id === req.user.id);
      const hasAssignments = encList.length > 0 || !!session.assigned_encoder_id;
      if (hasAssignments && !isDirectlyAssigned) {
        return res.status(403).json({ message: 'Access denied. You are not assigned to this session.' });
      }
    }

    res.json(session);
  } catch (error) {
    console.error('Fetch single session error:', error);
    res.status(500).json({ message: 'Error retrieving session' });
  }
});

// POST /api/sessions - Create new session(s) with multiple encoders and recurrence (Admin & Super Admin only)
router.post('/', authenticateToken, requireAdmin, async (req, res) => {
  const { 
    course_title, 
    session_date, 
    session_time, 
    start_time, 
    end_time, 
    category, 
    description, 
    assigned_encoder_ids, 
    assigned_encoder_id,
    recurrence 
  } = req.body;

  if (!course_title || !session_date || (!session_time && !start_time) || !category) {
    return res.status(400).json({ 
      message: 'Required fields: course_title, session_date, category, start_time/end_time' 
    });
  }

  const sDate = session_date.trim();
  const sCategory = category.trim();
  let sStart = (start_time || '').trim();
  let sEnd = (end_time || '').trim();
  let sTime = (session_time || '').trim();

  // Normalize encoder IDs
  let encoderIds = [];
  if (Array.isArray(assigned_encoder_ids)) {
    encoderIds = assigned_encoder_ids.map(id => parseInt(id, 10)).filter(id => !isNaN(id) && id > 0);
  } else if (assigned_encoder_id) {
    const parsed = parseInt(assigned_encoder_id, 10);
    if (!isNaN(parsed) && parsed > 0) encoderIds.push(parsed);
  }
  encoderIds = Array.from(new Set(encoderIds));
  const primaryEncoderId = encoderIds.length > 0 ? encoderIds[0] : null;

  if (!sStart || !sEnd) {
    const parts = sTime.split('-');
    if (parts.length === 2) {
      sStart = parts[0].trim();
      sEnd = parts[1].trim();
    } else {
      sStart = sTime || '09:00';
      sEnd = sTime || '11:00';
    }
  }

  if (sStart.length === 4 && sStart.includes(':')) sStart = '0' + sStart;
  if (sEnd.length === 4 && sEnd.includes(':')) sEnd = '0' + sEnd;

  if (!sTime) {
    sTime = `${sStart} - ${sEnd}`;
  }

  // Generate target dates (single or recurring series)
  const targetDates = generateSessionDates(sDate, recurrence);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const createdIds = [];
    const skippedOverlaps = [];

    for (const curDate of targetDates) {
      // Check time overlap on this specific date
      const [existing] = await conn.query(`
        SELECT id, course_title, category, session_time, start_time, end_time FROM sessions 
        WHERE session_date = ? 
          AND (category = ? OR category = 'All' OR ? = 'All')
          AND COALESCE(start_time, session_time) < ? 
          AND COALESCE(end_time, session_time) > ?
        LIMIT 1
      `, [curDate, sCategory, sCategory, sEnd, sStart]);

      if (existing.length > 0) {
        if (targetDates.length === 1) {
          await conn.rollback();
          const exTitle = existing[0].course_title;
          const exCat = existing[0].category;
          const exTime = existing[0].session_time || `${existing[0].start_time} - ${existing[0].end_time}`;
          return res.status(400).json({
            message: `Time Overlap Error: A session for category "${exCat}" already exists on ${curDate} from ${exTime} ("${exTitle}"). Overlapping time slots are not allowed.`
          });
        } else {
          skippedOverlaps.push({ date: curDate, existingTitle: existing[0].course_title });
          continue;
        }
      }

      const [result] = await conn.query(`
        INSERT INTO sessions (course_title, session_date, session_time, start_time, end_time, category, description, assigned_encoder_id, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id
      `, [
        course_title.trim(),
        curDate,
        sTime,
        sStart,
        sEnd,
        sCategory,
        (description || '').trim(),
        primaryEncoderId,
        req.user.id
      ]);

      const newId = result.insertId;
      createdIds.push(newId);

      // Insert multiple encoders into join table
      for (const encId of encoderIds) {
        await conn.query(`
          INSERT INTO session_encoders (session_id, user_id)
          VALUES (?, ?)
          ON CONFLICT (session_id, user_id) DO NOTHING
        `, [newId, encId]);
      }
    }

    if (createdIds.length === 0) {
      await conn.rollback();
      return res.status(400).json({
        message: 'Could not create recurring sessions due to overlapping schedules on all selected dates.'
      });
    }

    await conn.commit();

    const recurrenceNote = targetDates.length > 1 ? ` (${createdIds.length} recurring sessions created)` : '';
    const encodersNote = encoderIds.length > 0 ? ` [Assigned ${encoderIds.length} Encoder(s)]` : '';

    logActivity({
      userId: req.user.id,
      username: req.user.username,
      action: 'SESSION_CREATE',
      details: `Created session "${course_title.trim()}" for ${sCategory} starting on ${sDate} (${sTime})${recurrenceNote}${encodersNote}`,
      req
    });

    res.status(201).json({
      message: createdIds.length === 1 ? 'Session created successfully' : `${createdIds.length} recurring sessions created successfully`,
      sessionId: createdIds[0],
      sessionIds: createdIds,
      createdCount: createdIds.length,
      skippedOverlaps
    });
  } catch (error) {
    await conn.rollback();
    console.error('Create session error:', error);
    res.status(500).json({ message: error.message || 'Error creating session' });
  } finally {
    conn.release();
  }
});

// POST /api/sessions/:id/continue - Copy/continue existing session to new date(s) (Admin & Super Admin only)
router.post('/:id/continue', authenticateToken, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { 
    dates, 
    start_date, 
    recurrence,
    course_title,
    start_time,
    end_time,
    category,
    description,
    assigned_encoder_ids 
  } = req.body;

  try {
    const [existingSessions] = await pool.query('SELECT * FROM sessions WHERE id = ?', [id]);
    if (existingSessions.length === 0) {
      return res.status(404).json({ message: 'Original session not found' });
    }
    const orig = existingSessions[0];

    // Fetch original assigned encoders if not overridden
    let encoderIds = [];
    if (Array.isArray(assigned_encoder_ids)) {
      encoderIds = assigned_encoder_ids.map(Number).filter(n => !isNaN(n) && n > 0);
    } else {
      const [origEncRows] = await pool.query('SELECT user_id FROM session_encoders WHERE session_id = ?', [id]);
      encoderIds = origEncRows.map(r => r.user_id);
      if (encoderIds.length === 0 && orig.assigned_encoder_id) {
        encoderIds.push(orig.assigned_encoder_id);
      }
    }
    encoderIds = Array.from(new Set(encoderIds));
    const primaryEncoderId = encoderIds.length > 0 ? encoderIds[0] : null;

    const sTitle = (course_title || orig.course_title).trim();
    const sCategory = (category || orig.category).trim();
    const sDesc = (description !== undefined ? description : orig.description || '').trim();
    const sStart = (start_time || orig.start_time || '09:00').trim();
    const sEnd = (end_time || orig.end_time || '11:00').trim();
    const sTime = `${sStart} - ${sEnd}`;

    let targetDates = [];
    if (Array.isArray(dates) && dates.length > 0) {
      targetDates = dates.map(d => (d || '').trim()).filter(Boolean);
    } else if (start_date) {
      targetDates = generateSessionDates(start_date.trim(), recurrence);
    } else {
      return res.status(400).json({ message: 'Target date(s) or start_date required to continue session' });
    }

    targetDates = Array.from(new Set(targetDates)).sort();

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const createdIds = [];
      const skippedOverlaps = [];

      for (const curDate of targetDates) {
        const [existing] = await conn.query(`
          SELECT id, course_title, category, session_time, start_time, end_time FROM sessions 
          WHERE session_date = ? 
            AND (category = ? OR category = 'All' OR ? = 'All')
            AND COALESCE(start_time, session_time) < ? 
            AND COALESCE(end_time, session_time) > ?
          LIMIT 1
        `, [curDate, sCategory, sCategory, sEnd, sStart]);

        if (existing.length > 0) {
          skippedOverlaps.push({ date: curDate, existingTitle: existing[0].course_title });
          continue;
        }

        const [result] = await conn.query(`
          INSERT INTO sessions (course_title, session_date, session_time, start_time, end_time, category, description, assigned_encoder_id, created_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id
        `, [
          sTitle,
          curDate,
          sTime,
          sStart,
          sEnd,
          sCategory,
          sDesc,
          primaryEncoderId,
          req.user.id
        ]);

        const newId = result.insertId;
        createdIds.push(newId);

        for (const encId of encoderIds) {
          await conn.query(`
            INSERT INTO session_encoders (session_id, user_id)
            VALUES (?, ?)
            ON CONFLICT (session_id, user_id) DO NOTHING
          `, [newId, encId]);
        }
      }

      if (createdIds.length === 0) {
        await conn.rollback();
        return res.status(400).json({
          message: 'Could not copy session because schedules overlap on all selected dates.'
        });
      }

      await conn.commit();

      logActivity({
        userId: req.user.id,
        username: req.user.username,
        action: 'SESSION_CREATE',
        details: `Continued/copied session "${sTitle}" (${sCategory}) to ${createdIds.length} date(s): ${targetDates.join(', ')}`,
        req
      });

      res.status(201).json({
        message: `${createdIds.length} session(s) created to continue "${sTitle}"`,
        createdCount: createdIds.length,
        sessionIds: createdIds,
        skippedOverlaps
      });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  } catch (error) {
    console.error('Continue session error:', error);
    res.status(500).json({ message: error.message || 'Error continuing session' });
  }
});

// PUT /api/sessions/:id - Update session details and re-assign/add/change encoders (Admin & Super Admin only)
router.put('/:id', authenticateToken, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const {
    course_title,
    session_date,
    session_time,
    start_time,
    end_time,
    category,
    description,
    assigned_encoder_ids,
    assigned_encoder_id
  } = req.body;

  if (!course_title || !session_date || (!session_time && !start_time) || !category) {
    return res.status(400).json({
      message: 'Required fields: course_title, session_date, category, start_time/end_time'
    });
  }

  const sDate = session_date.trim();
  const sCategory = category.trim();
  let sStart = (start_time || '').trim();
  let sEnd = (end_time || '').trim();
  let sTime = (session_time || '').trim();

  // Normalize encoder IDs
  let encoderIds = [];
  if (Array.isArray(assigned_encoder_ids)) {
    encoderIds = assigned_encoder_ids.map(Number).filter(n => !isNaN(n) && n > 0);
  } else if (assigned_encoder_id) {
    const parsed = parseInt(assigned_encoder_id, 10);
    if (!isNaN(parsed) && parsed > 0) encoderIds.push(parsed);
  }
  encoderIds = Array.from(new Set(encoderIds));
  const primaryEncoderId = encoderIds.length > 0 ? encoderIds[0] : null;

  if (!sStart || !sEnd) {
    const parts = sTime.split('-');
    if (parts.length === 2) {
      sStart = parts[0].trim();
      sEnd = parts[1].trim();
    } else {
      sStart = sTime || '09:00';
      sEnd = sTime || '11:00';
    }
  }

  if (sStart.length === 4 && sStart.includes(':')) sStart = '0' + sStart;
  if (sEnd.length === 4 && sEnd.includes(':')) sEnd = '0' + sEnd;

  if (!sTime) {
    sTime = `${sStart} - ${sEnd}`;
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [existingSessions] = await conn.query('SELECT * FROM sessions WHERE id = ?', [id]);
    if (existingSessions.length === 0) {
      await conn.rollback();
      return res.status(404).json({ message: 'Session not found' });
    }

    // Check time collision with OTHER sessions (exclude this session id)
    const [overlap] = await conn.query(`
      SELECT id, course_title, category, session_time, start_time, end_time FROM sessions 
      WHERE id != ?
        AND session_date = ? 
        AND (category = ? OR category = 'All' OR ? = 'All')
        AND COALESCE(start_time, session_time) < ? 
        AND COALESCE(end_time, session_time) > ?
      LIMIT 1
    `, [id, sDate, sCategory, sCategory, sEnd, sStart]);

    if (overlap.length > 0) {
      await conn.rollback();
      const exTitle = overlap[0].course_title;
      const exCat = overlap[0].category;
      const exTime = overlap[0].session_time || `${overlap[0].start_time} - ${overlap[0].end_time}`;
      return res.status(400).json({
        message: `Time Overlap Error: Another session for category "${exCat}" already exists on ${sDate} from ${exTime} ("${exTitle}"). Overlapping time slots are not allowed.`
      });
    }

    // Update sessions table
    await conn.query(`
      UPDATE sessions
      SET course_title = ?,
          session_date = ?,
          session_time = ?,
          start_time = ?,
          end_time = ?,
          category = ?,
          description = ?,
          assigned_encoder_id = ?
      WHERE id = ?
    `, [
      course_title.trim(),
      sDate,
      sTime,
      sStart,
      sEnd,
      sCategory,
      (description || '').trim(),
      primaryEncoderId,
      id
    ]);

    // Replace session_encoders
    await conn.query('DELETE FROM session_encoders WHERE session_id = ?', [id]);
    for (const encId of encoderIds) {
      await conn.query(`
        INSERT INTO session_encoders (session_id, user_id)
        VALUES (?, ?)
        ON CONFLICT (session_id, user_id) DO NOTHING
      `, [id, encId]);
    }

    await conn.commit();

    const encodersNote = encoderIds.length > 0 ? ` [Assigned ${encoderIds.length} Encoder(s)]` : ' [No Encoders Assigned]';

    logActivity({
      userId: req.user.id,
      username: req.user.username,
      action: 'SESSION_UPDATE',
      details: `Updated session "${course_title.trim()}" (${sCategory}, ${sDate}, ${sTime})${encodersNote}`,
      req
    });

    res.json({
      message: 'Session updated successfully',
      sessionId: parseInt(id, 10)
    });
  } catch (error) {
    await conn.rollback();
    console.error('Update session error:', error);
    res.status(500).json({ message: error.message || 'Error updating session' });
  } finally {
    conn.release();
  }
});

// DELETE /api/sessions/:id - Delete session (Admin & Super Admin only; cannot delete if session has attendance unless Super Admin)
router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
  const { id } = req.params;

  try {
    const [existing] = await pool.query('SELECT course_title, session_date, category FROM sessions WHERE id = ?', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ message: 'Session not found' });
    }

    // Check if session has recorded attendance
    const [[attResult]] = await pool.query('SELECT COUNT(*) AS att_count FROM attendance WHERE session_id = ?', [id]);
    const attCount = parseInt(attResult?.att_count, 10) || 0;

    if (attCount > 0 && req.user.role !== 'super_admin') {
      return res.status(403).json({ 
        message: 'This session has recorded attendance data and cannot be deleted.' 
      });
    }

    const details = `Deleted session: "${existing[0].course_title}" (${existing[0].category}, ${existing[0].session_date})${attCount > 0 ? ` with ${attCount} attendance records removed` : ''}`;

    await pool.query('DELETE FROM sessions WHERE id = ?', [id]);

    logActivity({
      userId: req.user.id,
      username: req.user.username,
      action: 'SESSION_DELETE',
      details,
      req
    });

    res.json({ message: 'Session deleted successfully' });
  } catch (error) {
    console.error('Delete session error:', error);
    res.status(500).json({ message: 'Error deleting session' });
  }
});

module.exports = router;

