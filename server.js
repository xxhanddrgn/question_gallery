const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// --- Database Setup ---
const db = new Database(path.join(__dirname, 'questions.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id TEXT NOT NULL,
    student_name TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    date_key TEXT NOT NULL DEFAULT (date('now', 'localtime'))
  );

  CREATE TABLE IF NOT EXISTS likes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    question_id INTEGER NOT NULL,
    student_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE,
    UNIQUE(question_id, student_id)
  );

  CREATE INDEX IF NOT EXISTS idx_questions_date ON questions(date_key DESC);
  CREATE INDEX IF NOT EXISTS idx_likes_question ON likes(question_id);
`);

// --- Prepared Statements ---
const insertQuestion = db.prepare(
  'INSERT INTO questions (student_id, student_name, content, date_key) VALUES (?, ?, ?, date(\'now\', \'localtime\'))'
);

const getQuestionsByDate = db.prepare(`
  SELECT q.id, q.student_id, q.student_name, q.content, q.created_at,
         (SELECT COUNT(*) FROM likes WHERE question_id = q.id) AS like_count
  FROM questions q
  WHERE q.date_key = ?
  ORDER BY q.created_at DESC
`);

const getTodayQuestions = db.prepare(`
  SELECT q.id, q.student_id, q.student_name, q.content, q.created_at,
         (SELECT COUNT(*) FROM likes WHERE question_id = q.id) AS like_count
  FROM questions q
  WHERE q.date_key = date('now', 'localtime')
  ORDER BY q.created_at DESC
`);

const checkTodayQuestion = db.prepare(
  "SELECT id FROM questions WHERE student_id = ? AND date_key = date('now', 'localtime')"
);

const insertLike = db.prepare(
  'INSERT OR IGNORE INTO likes (question_id, student_id) VALUES (?, ?)'
);

const removeLike = db.prepare(
  'DELETE FROM likes WHERE question_id = ? AND student_id = ?'
);

const checkLike = db.prepare(
  'SELECT id FROM likes WHERE question_id = ? AND student_id = ?'
);

const getLikesByUser = db.prepare(`
  SELECT question_id FROM likes WHERE student_id = ? AND question_id IN (
    SELECT id FROM questions WHERE date_key = ?
  )
`);

const getTodayLikesByUser = db.prepare(`
  SELECT question_id FROM likes WHERE student_id = ? AND question_id IN (
    SELECT id FROM questions WHERE date_key = date('now', 'localtime')
  )
`);

const getAvailableDates = db.prepare(`
  SELECT DISTINCT date_key, COUNT(*) as question_count
  FROM questions
  GROUP BY date_key
  ORDER BY date_key DESC
  LIMIT 30
`);

const getQuestionCount = db.prepare(
  "SELECT COUNT(*) as count FROM questions WHERE date_key = date('now', 'localtime')"
);

// --- Middleware ---
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- API Routes ---

// Get today's questions
app.get('/api/questions/today', (req, res) => {
  const questions = getTodayQuestions.all();
  const count = getQuestionCount.get();
  res.json({ questions, total: count.count });
});

// Get questions by date
app.get('/api/questions/:date', (req, res) => {
  const { date } = req.params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: '잘못된 날짜 형식입니다.' });
  }
  const questions = getQuestionsByDate.all(date);
  res.json({ questions });
});

// Get available dates
app.get('/api/dates', (_req, res) => {
  const dates = getAvailableDates.all();
  res.json({ dates });
});

// Post a question
app.post('/api/questions', (req, res) => {
  const { studentId, studentName, content } = req.body;

  if (!studentId || !studentName || !content) {
    return res.status(400).json({ error: '반번호, 이름, 질문 내용을 모두 입력해주세요.' });
  }

  const trimmedId = studentId.trim();
  const trimmedName = studentName.trim();
  const trimmedContent = content.trim();

  if (trimmedId.length === 0 || trimmedId.length > 10) {
    return res.status(400).json({ error: '반번호를 올바르게 입력해주세요. (1~10자)' });
  }
  if (trimmedName.length === 0 || trimmedName.length > 20) {
    return res.status(400).json({ error: '이름을 올바르게 입력해주세요. (1~20자)' });
  }
  if (trimmedContent.length === 0 || trimmedContent.length > 500) {
    return res.status(400).json({ error: '질문은 1~500자 이내로 작성해주세요.' });
  }

  // Check if already posted today
  const existing = checkTodayQuestion.get(trimmedId);
  if (existing) {
    return res.status(409).json({ error: '오늘은 이미 질문을 올렸어요! 내일 다시 도전해주세요 😊' });
  }

  const result = insertQuestion.run(trimmedId, trimmedName, trimmedContent);
  res.status(201).json({ id: result.lastInsertRowid, message: '질문이 등록되었습니다!' });
});

// Toggle like
app.post('/api/questions/:id/like', (req, res) => {
  const questionId = parseInt(req.params.id, 10);
  const { studentId } = req.body;

  if (!studentId) {
    return res.status(400).json({ error: '좋아요를 누르려면 반번호를 입력해주세요.' });
  }

  if (isNaN(questionId)) {
    return res.status(400).json({ error: '잘못된 질문 ID입니다.' });
  }

  const existingLike = checkLike.get(questionId, studentId.trim());

  if (existingLike) {
    removeLike.run(questionId, studentId.trim());
    res.json({ liked: false, message: '좋아요를 취소했습니다.' });
  } else {
    insertLike.run(questionId, studentId.trim());
    res.json({ liked: true, message: '좋아요!' });
  }
});

// Get user's likes for today
app.get('/api/likes/:studentId/today', (req, res) => {
  const likes = getTodayLikesByUser.all(req.params.studentId);
  res.json({ likes: likes.map(l => l.question_id) });
});

// Get user's likes for a specific date
app.get('/api/likes/:studentId/:date', (req, res) => {
  const { studentId, date } = req.params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: '잘못된 날짜 형식입니다.' });
  }
  const likes = getLikesByUser.all(studentId, date);
  res.json({ likes: likes.map(l => l.question_id) });
});

// --- Start Server ---
app.listen(PORT, () => {
  console.log(`🎓 질문 챌린지 서버가 포트 ${PORT}에서 실행 중입니다!`);
  console.log(`   http://localhost:${PORT}`);
});
