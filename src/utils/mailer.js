const nodemailer = require('nodemailer');
require('dotenv').config();

/**
 * Check if SMTP credentials are configured in environment variables
 */
function isEmailConfigured() {
  const user = process.env.SMTP_USER || process.env.EMAIL_USER;
  const pass = process.env.SMTP_PASS || process.env.EMAIL_PASS || process.env.SMTP_PASSWORD;
  return Boolean(user && pass);
}

/**
 * Return current email configuration status (safe for Super Admin display)
 */
function getEmailConfigStatus() {
  const user = process.env.SMTP_USER || process.env.EMAIL_USER;
  const host = process.env.SMTP_HOST || (user && user.includes('@gmail.com') ? 'smtp.gmail.com' : 'Custom SMTP');
  const recipient = process.env.BACKUP_NOTIFICATION_EMAIL || user || '';

  return {
    configured: isEmailConfigured(),
    host,
    sender: user ? user.replace(/(.{3})(.*)(@.*)/, '$1***$3') : '',
    recipient: recipient ? recipient.replace(/(.{3})(.*)(@.*)/, '$1***$3') : '',
    fullRecipient: recipient
  };
}

/**
 * Create Nodemailer transport object
 */
function createTransporter() {
  if (!isEmailConfigured()) {
    return null;
  }

  const user = process.env.SMTP_USER || process.env.EMAIL_USER;
  const pass = process.env.SMTP_PASS || process.env.EMAIL_PASS || process.env.SMTP_PASSWORD;
  const host = process.env.SMTP_HOST || 'smtp.gmail.com';
  const port = parseInt(process.env.SMTP_PORT || '465', 10);
  const secure = process.env.SMTP_SECURE === 'true' || port === 465;

  if (host === 'smtp.gmail.com' || (user && user.includes('@gmail.com'))) {
    return nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user,
        pass
      }
    });
  }

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: {
      user,
      pass
    }
  });
}

/**
 * Send automated Sunday School Master Backup Excel email with attachment
 * @param {Object} options
 * @param {Buffer} options.buffer - In-memory Excel binary buffer
 * @param {string} options.filename - Name of the .xlsx file
 * @param {string} [options.recipientEmail] - Target recipient email (defaults to BACKUP_NOTIFICATION_EMAIL or SMTP_USER)
 * @param {Object} [options.counts] - Summary numbers { students, sessions, attendance }
 * @param {boolean} [options.isManual] - Whether triggered manually by admin
 */
async function sendWeeklyBackupEmail({ buffer, filename, recipientEmail, counts = {}, isManual = false }) {
  if (!isEmailConfigured()) {
    console.log('[Email Service] SMTP not configured. Skipping email dispatch. (To enable, configure SMTP_USER & SMTP_PASS in .env)');
    return {
      success: false,
      skipped: true,
      message: 'SMTP credentials not configured in environment variables'
    };
  }

  const targetEmail = recipientEmail || process.env.BACKUP_NOTIFICATION_EMAIL || process.env.SMTP_USER || process.env.EMAIL_USER;
  if (!targetEmail) {
    throw new Error('No recipient email specified and BACKUP_NOTIFICATION_EMAIL not set');
  }

  const transporter = createTransporter();
  const senderEmail = process.env.SMTP_FROM || `"Bete Yared Sunday School" <${process.env.SMTP_USER || process.env.EMAIL_USER}>`;
  const dateStr = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  const studentCount = counts.students || 0;
  const sessionCount = counts.sessions || 0;
  const attendanceCount = counts.attendance || 0;

  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f8fafc; color: #1e293b; margin: 0; padding: 20px; }
        .container { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden; border: 1px solid #e2e8f0; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); }
        .header { background: linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%); color: #ffffff; padding: 28px 24px; text-align: center; }
        .header h1 { margin: 0; font-size: 20px; font-weight: 700; letter-spacing: 0.5px; }
        .header p { margin: 6px 0 0 0; font-size: 13px; color: #bfdbfe; }
        .content { padding: 24px; }
        .badge { display: inline-block; padding: 4px 10px; font-size: 12px; font-weight: 700; border-radius: 20px; background: #dbeafe; color: #1e40af; margin-bottom: 16px; }
        .stat-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; margin: 20px 0; }
        .stat-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px 10px; text-align: center; }
        .stat-val { font-size: 20px; font-weight: 700; color: #1e3a8a; }
        .stat-lbl { font-size: 11px; color: #64748b; margin-top: 4px; text-transform: uppercase; letter-spacing: 0.5px; }
        .attachment-box { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 16px; margin: 20px 0; display: flex; align-items: center; }
        .footer { background: #f8fafc; border-top: 1px solid #e2e8f0; padding: 16px 24px; font-size: 12px; color: #64748b; text-align: center; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>✝️ ቤተ ያሬድ ሰንበት ትምሕርት ቤት</h1>
          <p>Bete Yared Sunday School Attendance & Database Backup</p>
        </div>
        <div class="content">
          <span class="badge">${isManual ? 'Manual Backup Export' : 'Automated Monday Night Backup'}</span>
          <h2 style="font-size: 16px; margin-top: 0; color: #0f172a;">Weekly Attendance & Database Register</h2>
          <p style="font-size: 14px; line-height: 1.6; color: #334155;">
            Selam Super Admin,<br>
            Attached to this email is the complete Sunday School multi-sheet Master Excel file generated on <strong>${dateStr}</strong>.
          </p>

          <table width="100%" cellspacing="0" cellpadding="0" style="margin: 20px 0; border: 1px solid #e2e8f0; border-radius: 8px; text-align: center;">
            <tr>
              <td style="padding: 14px; border-right: 1px solid #e2e8f0;">
                <div style="font-size: 20px; font-weight: 700; color: #1e3a8a;">${studentCount}</div>
                <div style="font-size: 11px; color: #64748b; text-transform: uppercase;">Total Students</div>
              </td>
              <td style="padding: 14px; border-right: 1px solid #e2e8f0;">
                <div style="font-size: 20px; font-weight: 700; color: #059669;">${sessionCount}</div>
                <div style="font-size: 11px; color: #64748b; text-transform: uppercase;">Sessions Held</div>
              </td>
              <td style="padding: 14px;">
                <div style="font-size: 20px; font-weight: 700; color: #d97706;">${attendanceCount}</div>
                <div style="font-size: 11px; color: #64748b; text-transform: uppercase;">Attendance Records</div>
              </td>
            </tr>
          </table>

          <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 14px; margin: 16px 0;">
            <strong style="color: #166534; font-size: 14px;">📎 Attached Document:</strong>
            <div style="font-family: monospace; font-size: 13px; color: #15803d; margin-top: 4px;">${filename}</div>
            <div style="font-size: 12px; color: #166534; margin-top: 4px;">
              Contains 5 tabs: Student Directory, Master Attendance Matrix, Sessions Held, Pastoral Follow-ups, and Promotions.
            </div>
          </div>

          <p style="font-size: 13px; color: #64748b; line-height: 1.5;">
            You can keep this file in your records or open it anytime in Microsoft Excel, Google Sheets, or Apple Numbers.
          </p>
        </div>
        <div class="footer">
          Bete Yared Sunday School Management System &bull; Confidential Super Admin Notification
        </div>
      </div>
    </body>
    </html>
  `;

  const mailOptions = {
    from: senderEmail,
    to: targetEmail,
    subject: `[Sunday School Backup] Weekly Master Attendance Register - ${filename.replace('.xlsx', '')}`,
    text: `Bete Yared Sunday School Database Backup\nDate: ${dateStr}\nStudents: ${studentCount} | Sessions: ${sessionCount} | Records: ${attendanceCount}\n\nPlease find the master Excel file attached: ${filename}`,
    html: htmlContent,
    attachments: [
      {
        filename,
        content: buffer
      }
    ]
  };

  const info = await transporter.sendMail(mailOptions);
  console.log(`[Email Service] Weekly backup email sent successfully to ${targetEmail}. MessageId: ${info.messageId}`);
  return {
    success: true,
    messageId: info.messageId,
    recipient: targetEmail
  };
}

module.exports = {
  isEmailConfigured,
  getEmailConfigStatus,
  sendWeeklyBackupEmail
};
