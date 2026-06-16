const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { requirePerm } = require('../utils/permissions');
const { touchEvent } = require('../utils/touch');

const router = express.Router({ mergeParams: true });
router.use(requireAuth);

const STATUSES = ['Rascunho', 'Finalizado'];

// GET /api/events/:id/post-report
router.get('/', requirePerm('can_view'), (req, res) => {
  const row = db.prepare('SELECT * FROM event_post_reports WHERE event_id = ?').get(Number(req.params.id));
  res.json({ report: row || null });
});

// PUT /api/events/:id/post-report  (upsert)
router.put('/', requirePerm('can_edit'), (req, res) => {
  const eventId = Number(req.params.id);
  const b = req.body || {};

  const rating = b.rating != null ? Number(b.rating) : null;
  const validRating = rating != null && rating >= 1 && rating <= 5 ? rating : null;
  const status = STATUSES.includes(b.status) ? b.status : 'Rascunho';

  db.prepare(`
    INSERT INTO event_post_reports
      (event_id, summary, audience_count, what_worked, what_improve, lessons, rating, status, updated_by, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(event_id) DO UPDATE SET
      summary        = excluded.summary,
      audience_count = excluded.audience_count,
      what_worked    = excluded.what_worked,
      what_improve   = excluded.what_improve,
      lessons        = excluded.lessons,
      rating         = excluded.rating,
      status         = excluded.status,
      updated_by     = excluded.updated_by,
      updated_at     = excluded.updated_at
  `).run(
    eventId,
    b.summary       ? String(b.summary).trim()      : null,
    b.audience_count != null ? Number(b.audience_count) || null : null,
    b.what_worked   ? String(b.what_worked).trim()  : null,
    b.what_improve  ? String(b.what_improve).trim() : null,
    b.lessons       ? String(b.lessons).trim()      : null,
    validRating,
    status,
    req.admin.name || req.admin.email
  );

  touchEvent(eventId);
  const row = db.prepare('SELECT * FROM event_post_reports WHERE event_id = ?').get(eventId);
  res.json({ report: row });
});

module.exports = router;
