/**
 * Audit logging utility.
 * Logs user actions for security and compliance tracking.
 */

const { getDb } = require('../db');

/**
 * Log an action to the audit trail.
 * @param {Object} params
 * @param {number} [params.userId] - User who performed the action
 * @param {string} [params.username] - Username (for display without JOIN)
 * @param {string} params.action - Action name (e.g., 'image.upload', 'user.login')
 * @param {string} [params.resourceType] - Resource type (e.g., 'image', 'user', 'collection')
 * @param {number} [params.resourceId] - Resource ID
 * @param {string} [params.details] - Additional details (JSON string or plain text)
 * @param {string} [params.ip] - Client IP address
 */
function log({ userId, username, action, resourceType, resourceId, details, ip }) {
  try {
    const db = getDb();
    db.prepare(`
      INSERT INTO audit_logs (user_id, username, action, resource_type, resource_id, details, ip_address)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(userId || null, username || null, action, resourceType || null, resourceId || null, details || null, ip || null);
  } catch (e) {
    console.error('[Audit] Failed to log:', e.message);
  }
}

/**
 * Express middleware helper — extracts user + IP from request.
 */
function fromReq(req, action, resourceType, resourceId, details) {
  log({
    userId: req.user?.id,
    username: req.user?.username,
    action,
    resourceType,
    resourceId,
    details: typeof details === 'object' ? JSON.stringify(details) : details,
    ip: req.ip || req.headers['x-forwarded-for'] || req.connection?.remoteAddress,
  });
}

/**
 * Query audit logs with filters.
 */
function query({ userId, action, resourceType, limit = 50, offset = 0 } = {}) {
  const db = getDb();
  const conditions = [];
  const params = {};

  if (userId) { conditions.push('user_id = @userId'); params.userId = userId; }
  if (action) { conditions.push('action LIKE @action'); params.action = `${action}%`; }
  if (resourceType) { conditions.push('resource_type = @resourceType'); params.resourceType = resourceType; }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const total = db.prepare(`SELECT COUNT(*) as count FROM audit_logs ${where}`).get(params);
  const logs = db.prepare(`
    SELECT * FROM audit_logs ${where} ORDER BY created_at DESC LIMIT @limit OFFSET @offset
  `).all({ ...params, limit, offset });

  return { total: total.count, logs };
}

/**
 * Delete logs older than N days.
 */
function cleanup(daysOld = 90) {
  const db = getDb();
  const result = db.prepare("DELETE FROM audit_logs WHERE created_at < datetime('now', '-' || ? || ' days')").run(daysOld);
  return result.changes;
}

module.exports = { log, fromReq, query, cleanup };
