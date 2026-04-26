import os
import io
import csv
import sqlite3
import hashlib
import secrets
import random
from datetime import datetime, date, timezone, timedelta
from functools import wraps
from flask import Flask, request, jsonify, session, send_from_directory, Response

app = Flask(__name__, static_folder='static', static_url_path='/static')

SECRET_KEY_FILE = os.path.join(os.path.dirname(__file__), 'data', '.secret_key')

def get_or_create_secret_key():
    os.makedirs(os.path.dirname(SECRET_KEY_FILE), exist_ok=True)
    if os.path.exists(SECRET_KEY_FILE):
        with open(SECRET_KEY_FILE, 'r') as f:
            return f.read().strip()
    key = secrets.token_hex(32)
    with open(SECRET_KEY_FILE, 'w') as f:
        f.write(key)
    return key

app.secret_key = os.environ.get('SECRET_KEY') or get_or_create_secret_key()
app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'

DB_PATH = os.path.join(os.path.dirname(__file__), 'data', 'questions.db')

# Korean Standard Time (UTC+9)
KST = timezone(timedelta(hours=9))


def kst_today():
    """Get today's date in KST as ISO format string."""
    return datetime.now(KST).date().isoformat()


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = get_db()
    conn.executescript('''
        CREATE TABLE IF NOT EXISTS students (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            grade INTEGER NOT NULL,
            class_num INTEGER NOT NULL,
            student_num INTEGER NOT NULL,
            name TEXT NOT NULL,
            pin TEXT DEFAULT NULL,
            pin_hash TEXT DEFAULT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(grade, class_num, student_num, name)
        );

        CREATE TABLE IF NOT EXISTS questions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            student_id INTEGER NOT NULL,
            content TEXT NOT NULL,
            created_date TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            is_deleted INTEGER DEFAULT 0,
            FOREIGN KEY (student_id) REFERENCES students(id)
        );

        CREATE TABLE IF NOT EXISTS likes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            question_id INTEGER NOT NULL,
            student_id INTEGER NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(question_id, student_id),
            FOREIGN KEY (question_id) REFERENCES questions(id),
            FOREIGN KEY (student_id) REFERENCES students(id)
        );

        CREATE TABLE IF NOT EXISTS admins (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_questions_date ON questions(created_date);
        CREATE INDEX IF NOT EXISTS idx_questions_student ON questions(student_id);
        CREATE INDEX IF NOT EXISTS idx_likes_question ON likes(question_id);
        CREATE INDEX IF NOT EXISTS idx_likes_student ON likes(student_id);
    ''')

    try:
        conn.execute("SELECT pin_hash FROM students LIMIT 1")
    except sqlite3.OperationalError:
        conn.execute("ALTER TABLE students ADD COLUMN pin_hash TEXT DEFAULT NULL")

    try:
        conn.execute("SELECT pin FROM students LIMIT 1")
    except sqlite3.OperationalError:
        conn.execute("ALTER TABLE students ADD COLUMN pin TEXT DEFAULT NULL")

    admin = conn.execute("SELECT id FROM admins WHERE username = 'admin'").fetchone()
    if not admin:
        pw_hash = hashlib.sha256('admin123'.encode()).hexdigest()
        conn.execute("INSERT INTO admins (username, password_hash) VALUES (?, ?)", ('admin', pw_hash))

    # Migrate existing question dates from UTC to KST
    # v2: force re-run to fix questions that weren't migrated in v1
    migrated = conn.execute("SELECT value FROM settings WHERE key = 'dates_migrated_to_kst_v2'").fetchone()
    if not migrated:
        conn.execute("""
            UPDATE questions
            SET created_date = DATE(created_at, '+9 hours')
            WHERE created_at IS NOT NULL
              AND created_date != DATE(created_at, '+9 hours')
        """)
        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES ('dates_migrated_to_kst_v2', '1')"
        )

    conn.commit()
    conn.close()


def get_setting(conn, key, default=None):
    row = conn.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
    return row['value'] if row else default


def set_setting(conn, key, value):
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?",
        (key, value, value)
    )


def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if 'student_id' not in session and 'admin_id' not in session:
            return jsonify({'error': '로그인이 필요합니다'}), 401
        return f(*args, **kwargs)
    return decorated


def admin_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if 'admin_id' not in session:
            return jsonify({'error': '관리자 로그인이 필요합니다'}), 401
        return f(*args, **kwargs)
    return decorated


# -- Pages --

@app.route('/')
def index():
    return send_from_directory('static', 'index.html')


@app.route('/admin')
def admin_page():
    return send_from_directory('static', 'admin.html')


@app.route('/hall')
def hall_page():
    return send_from_directory('static', 'hall.html')


# -- Auth API --

@app.route('/api/login', methods=['POST'])
def login():
    data = request.json
    grade = data.get('grade')
    class_num = data.get('class_num')
    student_num = data.get('student_num')
    name = data.get('name', '').strip()
    pin = data.get('pin', '').strip()

    if not all([grade, class_num, student_num, name]):
        return jsonify({'error': '모든 항목을 입력해주세요'}), 400

    try:
        grade = int(grade)
        class_num = int(class_num)
        student_num = int(student_num)
    except (ValueError, TypeError):
        return jsonify({'error': '학년, 반, 번호는 숫자로 입력해주세요'}), 400

    if grade < 1 or grade > 6:
        return jsonify({'error': '학년은 1~6 사이로 입력해주세요'}), 400

    conn = get_db()
    student = conn.execute(
        "SELECT id, pin, pin_hash FROM students WHERE grade=? AND class_num=? AND student_num=? AND name=?",
        (grade, class_num, student_num, name)
    ).fetchone()

    if not student:
        if not pin:
            conn.close()
            return jsonify({'need_pin_setup': True, 'message': '처음 오셨네요! 4자리 비밀번호를 설정해주세요.'}), 200
        if len(pin) != 4 or not pin.isdigit():
            conn.close()
            return jsonify({'error': '비밀번호는 숫자 4자리로 설정해주세요'}), 400
        pin_hash = hashlib.sha256(pin.encode()).hexdigest()
        conn.execute(
            "INSERT INTO students (grade, class_num, student_num, name, pin, pin_hash) VALUES (?, ?, ?, ?, ?, ?)",
            (grade, class_num, student_num, name, pin, pin_hash)
        )
        conn.commit()
        student = conn.execute(
            "SELECT id, pin, pin_hash FROM students WHERE grade=? AND class_num=? AND student_num=? AND name=?",
            (grade, class_num, student_num, name)
        ).fetchone()
    else:
        has_pin = student['pin'] is not None or student['pin_hash'] is not None
        if not has_pin:
            if not pin:
                conn.close()
                return jsonify({'need_pin_setup': True, 'message': '비밀번호가 아직 설정되지 않았어요. 4자리 비밀번호를 설정해주세요.'}), 200
            if len(pin) != 4 or not pin.isdigit():
                conn.close()
                return jsonify({'error': '비밀번호는 숫자 4자리로 설정해주세요'}), 400
            pin_hash = hashlib.sha256(pin.encode()).hexdigest()
            conn.execute("UPDATE students SET pin = ?, pin_hash = ? WHERE id = ?", (pin, pin_hash, student['id']))
            conn.commit()
        else:
            if not pin:
                conn.close()
                return jsonify({'need_pin': True, 'message': '비밀번호를 입력해주세요.'}), 200
            if student['pin'] is not None:
                if student['pin'] != pin:
                    conn.close()
                    return jsonify({'error': '비밀번호가 올바르지 않습니다'}), 401
            else:
                pin_hash = hashlib.sha256(pin.encode()).hexdigest()
                if student['pin_hash'] != pin_hash:
                    conn.close()
                    return jsonify({'error': '비밀번호가 올바르지 않습니다'}), 401
                conn.execute("UPDATE students SET pin = ? WHERE id = ?", (pin, student['id']))
                conn.commit()

    session['student_id'] = student['id']
    session['student_grade'] = grade
    session['student_class'] = class_num
    session['student_num'] = student_num
    session['student_name'] = name
    conn.close()

    return jsonify({
        'success': True,
        'student': {
            'id': student['id'],
            'grade': grade,
            'class_num': class_num,
            'student_num': student_num,
            'name': name
        }
    })


@app.route('/api/logout', methods=['POST'])
def logout():
    session.clear()
    return jsonify({'success': True})


@app.route('/api/me')
def me():
    if 'admin_id' in session and session.get('admin_student_mode'):
        return jsonify({
            'logged_in': True,
            'is_admin': True,
            'student': {
                'id': 0,
                'grade': 0,
                'class_num': 0,
                'student_num': 0,
                'name': '관리자'
            }
        })
    if 'student_id' not in session:
        return jsonify({'logged_in': False})
    return jsonify({
        'logged_in': True,
        'is_admin': False,
        'student': {
            'id': session['student_id'],
            'grade': session['student_grade'],
            'class_num': session['student_class'],
            'student_num': session['student_num'],
            'name': session['student_name']
        }
    })


# -- Questions API --

@app.route('/api/questions', methods=['GET'])
@login_required
def get_questions():
    target_date = request.args.get('date', kst_today())
    sort = request.args.get('sort', 'latest')
    grade_filter = request.args.get('grade', '')  # Feature 1: grade filter
    page = request.args.get('page', '1')
    page = max(1, int(page)) if page.isdigit() else 1
    per_page = 20

    conn = get_db()
    is_admin = 'admin_id' in session and session.get('admin_student_mode')
    student_id = 0 if is_admin else session.get('student_id', 0)

    if sort == 'likes':
        order = 'like_count DESC, q.created_at DESC'
    else:
        order = 'q.created_at DESC'

    # Build query with optional grade filter
    params = [student_id, target_date]
    grade_clause = ''
    if grade_filter and grade_filter.isdigit():
        grade_clause = 'AND s.grade = ?'
        params.append(int(grade_filter))

    count_params = [target_date]
    count_grade_clause = ''
    if grade_filter and grade_filter.isdigit():
        count_grade_clause = 'AND s.grade = ?'
        count_params.append(int(grade_filter))

    total_count = conn.execute(f'''
        SELECT COUNT(*) FROM questions q
        JOIN students s ON q.student_id = s.id
        WHERE q.created_date = ? AND q.is_deleted = 0 {count_grade_clause}
    ''', count_params).fetchone()[0]

    total_pages = max(1, (total_count + per_page - 1) // per_page)
    if page > total_pages:
        page = total_pages
    offset = (page - 1) * per_page

    questions = conn.execute(f'''
        SELECT q.id, q.content, q.created_at, q.created_date, q.student_id,
               s.grade, s.class_num, s.student_num, s.name,
               COUNT(DISTINCT l.id) as like_count,
               MAX(CASE WHEN l.student_id = ? THEN 1 ELSE 0 END) as liked_by_me
        FROM questions q
        JOIN students s ON q.student_id = s.id
        LEFT JOIN likes l ON q.id = l.question_id
        WHERE q.created_date = ? AND q.is_deleted = 0 {grade_clause}
        GROUP BY q.id
        ORDER BY {order}
        LIMIT ? OFFSET ?
    ''', params + [per_page, offset]).fetchall()

    result = []
    for q in questions:
        is_mine = False
        if not is_admin:
            is_mine = (q['student_num'] == session.get('student_num') and
                       q['grade'] == session.get('student_grade') and
                       q['class_num'] == session.get('student_class'))
        result.append({
            'id': q['id'],
            'content': q['content'],
            'created_at': q['created_at'],
            'created_date': q['created_date'],
            'author': f"{q['grade']}-{q['class_num']} {q['name']}",
            'grade': q['grade'],
            'class_num': q['class_num'],
            'like_count': q['like_count'],
            'liked_by_me': bool(q['liked_by_me']),
            'is_mine': is_mine,
            'can_edit': is_mine or is_admin,  # Feature 3: admin can edit/delete
        })

    today_question = None
    if not is_admin:
        today_question = conn.execute(
            "SELECT id FROM questions WHERE student_id = ? AND created_date = ? AND is_deleted = 0",
            (student_id, kst_today())
        ).fetchone()

    conn.close()
    return jsonify({
        'questions': result,
        'already_posted_today': today_question is not None if not is_admin else True,
        'date': target_date,
        'total_count': total_count,
        'page': page,
        'total_pages': total_pages,
        'per_page': per_page,
        'is_admin': is_admin,
    })


@app.route('/api/questions', methods=['POST'])
@login_required
def create_question():
    if 'admin_id' in session and session.get('admin_student_mode'):
        return jsonify({'error': '관리자 모드에서는 질문을 작성할 수 없습니다'}), 400

    data = request.json
    content = data.get('content', '').strip()

    if not content:
        return jsonify({'error': '질문 내용을 입력해주세요'}), 400
    if len(content) > 200:
        return jsonify({'error': '질문은 200자 이내로 작성해주세요'}), 400

    student_id = session['student_id']
    today = kst_today()

    conn = get_db()
    existing = conn.execute(
        "SELECT id FROM questions WHERE student_id = ? AND created_date = ? AND is_deleted = 0",
        (student_id, today)
    ).fetchone()

    if existing:
        conn.close()
        return jsonify({'error': '오늘은 이미 질문을 올렸어요! 내일 다시 도전해보세요'}), 400

    conn.execute(
        "INSERT INTO questions (student_id, content, created_date) VALUES (?, ?, ?)",
        (student_id, content, today)
    )
    conn.commit()
    conn.close()

    return jsonify({'success': True, 'message': '질문이 등록되었어요!'})


# -- Student Edit/Delete API (also allows admin) --

@app.route('/api/questions/<int:question_id>', methods=['PUT'])
@login_required
def update_question(question_id):
    is_admin = 'admin_id' in session and session.get('admin_student_mode')
    student_id = session.get('student_id', 0)
    data = request.json
    content = data.get('content', '').strip()

    if not content:
        return jsonify({'error': '질문 내용을 입력해주세요'}), 400
    if len(content) > 200:
        return jsonify({'error': '질문은 200자 이내로 작성해주세요'}), 400

    conn = get_db()
    question = conn.execute(
        "SELECT id, student_id FROM questions WHERE id = ? AND is_deleted = 0", (question_id,)
    ).fetchone()

    if not question:
        conn.close()
        return jsonify({'error': '질문을 찾을 수 없습니다'}), 404

    if not is_admin and question['student_id'] != student_id:
        conn.close()
        return jsonify({'error': '본인의 질문만 수정할 수 있습니다'}), 403

    conn.execute("UPDATE questions SET content = ? WHERE id = ?", (content, question_id))
    conn.commit()
    conn.close()
    return jsonify({'success': True, 'message': '질문이 수정되었어요!'})


@app.route('/api/questions/<int:question_id>', methods=['DELETE'])
@login_required
def delete_question(question_id):
    is_admin = 'admin_id' in session and session.get('admin_student_mode')
    student_id = session.get('student_id', 0)
    conn = get_db()

    question = conn.execute(
        "SELECT id, student_id FROM questions WHERE id = ? AND is_deleted = 0", (question_id,)
    ).fetchone()

    if not question:
        conn.close()
        return jsonify({'error': '질문을 찾을 수 없습니다'}), 404

    if not is_admin and question['student_id'] != student_id:
        conn.close()
        return jsonify({'error': '본인의 질문만 삭제할 수 있습니다'}), 403

    conn.execute("UPDATE questions SET is_deleted = 1 WHERE id = ?", (question_id,))
    conn.commit()
    conn.close()
    return jsonify({'success': True, 'message': '질문이 삭제되었어요.'})


# -- Likes API --

@app.route('/api/questions/<int:question_id>/like', methods=['POST'])
@login_required
def toggle_like(question_id):
    if 'admin_id' in session and session.get('admin_student_mode'):
        return jsonify({'error': '관리자 모드에서는 좋아요를 할 수 없습니다'}), 400

    student_id = session['student_id']
    conn = get_db()

    question = conn.execute(
        "SELECT id, student_id FROM questions WHERE id = ? AND is_deleted = 0", (question_id,)
    ).fetchone()

    if not question:
        conn.close()
        return jsonify({'error': '질문을 찾을 수 없습니다'}), 404

    existing = conn.execute(
        "SELECT id FROM likes WHERE question_id = ? AND student_id = ?",
        (question_id, student_id)
    ).fetchone()

    if existing:
        conn.execute("DELETE FROM likes WHERE id = ?", (existing['id'],))
        liked = False
    else:
        conn.execute(
            "INSERT INTO likes (question_id, student_id) VALUES (?, ?)",
            (question_id, student_id)
        )
        liked = True

    conn.commit()

    like_count = conn.execute(
        "SELECT COUNT(*) as cnt FROM likes WHERE question_id = ?", (question_id,)
    ).fetchone()['cnt']

    conn.close()
    return jsonify({'success': True, 'liked': liked, 'like_count': like_count})


# -- Date list API --

@app.route('/api/dates')
@login_required
def get_dates():
    conn = get_db()
    dates = conn.execute('''
        SELECT DISTINCT created_date, COUNT(*) as question_count
        FROM questions WHERE is_deleted = 0
        GROUP BY created_date
        ORDER BY created_date DESC
        LIMIT 30
    ''').fetchall()
    conn.close()

    return jsonify({
        'dates': [{'date': d['created_date'], 'count': d['question_count']} for d in dates]
    })


# -- Admin API --

@app.route('/api/admin/login', methods=['POST'])
def admin_login():
    data = request.json
    username = data.get('username', '').strip()
    password = data.get('password', '')

    if not username or not password:
        return jsonify({'error': '아이디와 비밀번호를 입력해주세요'}), 400

    pw_hash = hashlib.sha256(password.encode()).hexdigest()
    conn = get_db()
    admin = conn.execute(
        "SELECT id, username FROM admins WHERE username = ? AND password_hash = ?",
        (username, pw_hash)
    ).fetchone()
    conn.close()

    if not admin:
        return jsonify({'error': '아이디 또는 비밀번호가 올바르지 않습니다'}), 401

    session['admin_id'] = admin['id']
    session['admin_username'] = admin['username']
    return jsonify({'success': True, 'username': admin['username']})


@app.route('/api/admin/logout', methods=['POST'])
def admin_logout():
    session.pop('admin_id', None)
    session.pop('admin_username', None)
    session.pop('admin_student_mode', None)
    return jsonify({'success': True})


@app.route('/api/admin/me')
def admin_me():
    if 'admin_id' not in session:
        return jsonify({'logged_in': False})
    return jsonify({'logged_in': True, 'username': session['admin_username']})


# Feature 3: Admin enters student page mode
@app.route('/api/admin/student-mode', methods=['POST'])
@admin_required
def admin_student_mode():
    session['admin_student_mode'] = True
    return jsonify({'success': True, 'message': '학생 페이지 관리 모드로 전환합니다.'})


@app.route('/api/admin/exit-student-mode', methods=['POST'])
def admin_exit_student_mode():
    session.pop('admin_student_mode', None)
    return jsonify({'success': True})


@app.route('/api/admin/questions', methods=['GET'])
@admin_required
def admin_get_questions():
    target_date = request.args.get('date', kst_today())
    conn = get_db()

    questions = conn.execute('''
        SELECT q.id, q.content, q.created_at, q.created_date, q.is_deleted,
               s.grade, s.class_num, s.student_num, s.name,
               COUNT(DISTINCT l.id) as like_count
        FROM questions q
        JOIN students s ON q.student_id = s.id
        LEFT JOIN likes l ON q.id = l.question_id
        WHERE q.created_date = ?
        GROUP BY q.id
        ORDER BY q.created_at DESC
    ''', (target_date,)).fetchall()

    conn.close()
    return jsonify({
        'questions': [{
            'id': q['id'],
            'content': q['content'],
            'created_at': q['created_at'],
            'author': f"{q['grade']}-{q['class_num']} {q['name']} ({q['student_num']}번)",
            'like_count': q['like_count'],
            'is_deleted': bool(q['is_deleted'])
        } for q in questions],
        'date': target_date
    })


@app.route('/api/admin/questions/<int:question_id>', methods=['DELETE'])
@admin_required
def admin_delete_question(question_id):
    conn = get_db()
    conn.execute("UPDATE questions SET is_deleted = 1 WHERE id = ?", (question_id,))
    conn.commit()
    conn.close()
    return jsonify({'success': True})


@app.route('/api/admin/questions/<int:question_id>/restore', methods=['POST'])
@admin_required
def admin_restore_question(question_id):
    conn = get_db()
    conn.execute("UPDATE questions SET is_deleted = 0 WHERE id = ?", (question_id,))
    conn.commit()
    conn.close()
    return jsonify({'success': True})


@app.route('/api/admin/questions/bulk-delete', methods=['POST'])
@admin_required
def admin_bulk_delete_questions():
    data = request.json
    ids = data.get('ids', [])
    if not ids:
        return jsonify({'error': '삭제할 질문을 선택해주세요'}), 400

    conn = get_db()
    placeholders = ','.join(['?' for _ in ids])
    conn.execute(f"UPDATE questions SET is_deleted = 1 WHERE id IN ({placeholders})", ids)
    conn.commit()
    conn.close()
    return jsonify({'success': True, 'message': f'{len(ids)}개의 질문이 삭제되었습니다.'})


@app.route('/api/admin/questions/bulk-restore', methods=['POST'])
@admin_required
def admin_bulk_restore_questions():
    data = request.json
    ids = data.get('ids', [])
    if not ids:
        return jsonify({'error': '복원할 질문을 선택해주세요'}), 400

    conn = get_db()
    placeholders = ','.join(['?' for _ in ids])
    conn.execute(f"UPDATE questions SET is_deleted = 0 WHERE id IN ({placeholders})", ids)
    conn.commit()
    conn.close()
    return jsonify({'success': True, 'message': f'{len(ids)}개의 질문이 복원되었습니다.'})


@app.route('/api/admin/stats')
@admin_required
def admin_stats():
    conn = get_db()

    total_students = conn.execute("SELECT COUNT(*) as cnt FROM students").fetchone()['cnt']
    total_questions = conn.execute(
        "SELECT COUNT(*) as cnt FROM questions WHERE is_deleted = 0"
    ).fetchone()['cnt']
    total_likes = conn.execute("SELECT COUNT(*) as cnt FROM likes").fetchone()['cnt']

    today = kst_today()
    today_questions = conn.execute(
        "SELECT COUNT(*) as cnt FROM questions WHERE created_date = ? AND is_deleted = 0",
        (today,)
    ).fetchone()['cnt']

    daily_stats = conn.execute('''
        SELECT created_date, COUNT(*) as cnt
        FROM questions WHERE is_deleted = 0
        GROUP BY created_date
        ORDER BY created_date DESC
        LIMIT 14
    ''').fetchall()

    grade_stats = conn.execute('''
        SELECT s.grade,
               COUNT(DISTINCT s.id) as student_count,
               COUNT(DISTINCT q.id) as question_count
        FROM students s
        LEFT JOIN questions q ON s.id = q.student_id AND q.is_deleted = 0
        GROUP BY s.grade
        ORDER BY s.grade
    ''').fetchall()

    hall_reset_date = get_setting(conn, 'hall_reset_date', '2000-01-01')
    top_questions = conn.execute('''
        SELECT q.content, s.grade, s.class_num, s.name,
               COUNT(l.id) as like_count
        FROM questions q
        JOIN students s ON q.student_id = s.id
        LEFT JOIN likes l ON q.id = l.question_id
        WHERE q.is_deleted = 0 AND q.created_date >= ?
        GROUP BY q.id
        HAVING like_count > 0
        ORDER BY like_count DESC
        LIMIT 10
    ''', (hall_reset_date,)).fetchall()

    conn.close()
    return jsonify({
        'total_students': total_students,
        'total_questions': total_questions,
        'total_likes': total_likes,
        'today_questions': today_questions,
        'daily_stats': [{'date': d['created_date'], 'count': d['cnt']} for d in daily_stats],
        'grade_stats': [{
            'grade': g['grade'],
            'student_count': g['student_count'],
            'question_count': g['question_count']
        } for g in grade_stats],
        'top_questions': [{
            'content': q['content'],
            'author': f"{q['grade']}-{q['class_num']} {q['name']}",
            'like_count': q['like_count']
        } for q in top_questions]
    })


# -- Admin PIN Reset --

@app.route('/api/admin/reset-pin/<int:student_id>', methods=['POST'])
@admin_required
def admin_reset_pin(student_id):
    conn = get_db()
    student = conn.execute("SELECT id, grade, class_num, student_num, name FROM students WHERE id = ?", (student_id,)).fetchone()
    if not student:
        conn.close()
        return jsonify({'error': '학생을 찾을 수 없습니다'}), 404
    conn.execute("UPDATE students SET pin = NULL, pin_hash = NULL WHERE id = ?", (student_id,))
    conn.commit()
    conn.close()
    return jsonify({'success': True, 'message': f"{student['grade']}-{student['class_num']} {student['name']} 학생의 비밀번호가 초기화되었습니다."})


@app.route('/api/admin/generate-pins', methods=['POST'])
@admin_required
def admin_generate_pins():
    data = request.json
    target = data.get('target', 'no_pin')

    if target not in ('no_pin', 'all'):
        return jsonify({'error': '잘못된 대상입니다'}), 400

    conn = get_db()

    if target == 'no_pin':
        students = conn.execute(
            "SELECT id, grade, class_num, student_num, name FROM students WHERE pin IS NULL AND pin_hash IS NULL"
        ).fetchall()
    else:
        students = conn.execute(
            "SELECT id, grade, class_num, student_num, name FROM students"
        ).fetchall()

    results = []
    for s in students:
        new_pin = str(random.randint(1000, 9999))
        new_pin_hash = hashlib.sha256(new_pin.encode()).hexdigest()
        conn.execute("UPDATE students SET pin = ?, pin_hash = ? WHERE id = ?", (new_pin, new_pin_hash, s['id']))
        results.append({
            'id': s['id'],
            'grade': s['grade'],
            'class_num': s['class_num'],
            'student_num': s['student_num'],
            'name': s['name'],
            'pin': new_pin
        })

    conn.commit()
    conn.close()

    return jsonify({
        'success': True,
        'count': len(results),
        'students': results,
        'message': f'{len(results)}명의 비밀번호가 생성되었습니다.'
    })


@app.route('/api/admin/set-pins', methods=['POST'])
@admin_required
def admin_set_pins():
    data = request.json
    student_ids = data.get('student_ids', [])
    custom_pin = data.get('pin', '').strip()

    if not student_ids:
        return jsonify({'error': '학생을 선택해주세요'}), 400

    if not custom_pin or len(custom_pin) != 4 or not custom_pin.isdigit():
        return jsonify({'error': '비밀번호는 숫자 4자리로 입력해주세요'}), 400

    conn = get_db()
    pin_hash = hashlib.sha256(custom_pin.encode()).hexdigest()

    updated = 0
    for sid in student_ids:
        student = conn.execute("SELECT id FROM students WHERE id = ?", (sid,)).fetchone()
        if student:
            conn.execute("UPDATE students SET pin = ?, pin_hash = ? WHERE id = ?", (custom_pin, pin_hash, sid))
            updated += 1

    conn.commit()
    conn.close()

    return jsonify({
        'success': True,
        'count': updated,
        'message': f'{updated}명의 비밀번호가 설정되었습니다. (비밀번호: {custom_pin})'
    })


@app.route('/api/admin/students')
@admin_required
def admin_get_students():
    conn = get_db()
    students = conn.execute('''
        SELECT id, grade, class_num, student_num, name, pin, pin_hash,
               (SELECT COUNT(*) FROM questions WHERE student_id = students.id AND is_deleted = 0) as question_count
        FROM students
        ORDER BY grade, class_num, student_num
    ''').fetchall()
    conn.close()
    return jsonify({
        'students': [{
            'id': s['id'],
            'grade': s['grade'],
            'class_num': s['class_num'],
            'student_num': s['student_num'],
            'name': s['name'],
            'pin': s['pin'] if s['pin'] else None,
            'has_pin': s['pin'] is not None or s['pin_hash'] is not None,
            'pin_viewable': s['pin'] is not None,
            'question_count': s['question_count']
        } for s in students]
    })


# Feature 2: Admin delete student account
@app.route('/api/admin/students/<int:student_id>', methods=['DELETE'])
@admin_required
def admin_delete_student(student_id):
    conn = get_db()
    student = conn.execute("SELECT id, grade, class_num, name FROM students WHERE id = ?", (student_id,)).fetchone()
    if not student:
        conn.close()
        return jsonify({'error': '학생을 찾을 수 없습니다'}), 404

    # Delete likes on their questions
    conn.execute("DELETE FROM likes WHERE question_id IN (SELECT id FROM questions WHERE student_id = ?)", (student_id,))
    # Delete their likes
    conn.execute("DELETE FROM likes WHERE student_id = ?", (student_id,))
    # Delete their questions
    conn.execute("DELETE FROM questions WHERE student_id = ?", (student_id,))
    # Delete the student
    conn.execute("DELETE FROM students WHERE id = ?", (student_id,))
    conn.commit()
    conn.close()
    return jsonify({'success': True, 'message': f"{student['grade']}-{student['class_num']} {student['name']} 학생의 계정이 삭제되었습니다."})


# -- Admin Reset Hall of Fame --

@app.route('/api/admin/reset-hall', methods=['POST'])
@admin_required
def reset_hall():
    conn = get_db()
    today = kst_today()
    set_setting(conn, 'hall_reset_date', today)
    conn.commit()
    conn.close()
    return jsonify({'success': True, 'message': f'명예의 전당이 초기화되었습니다. ({today}부터 새로 집계됩니다.)'})


# -- Topic API --

@app.route('/api/topic')
def get_topic():
    conn = get_db()
    topic = get_setting(conn, 'current_topic', '')
    conn.close()
    return jsonify({'topic': topic})


@app.route('/api/admin/topic', methods=['GET'])
@admin_required
def admin_get_topic():
    conn = get_db()
    topic = get_setting(conn, 'current_topic', '')
    conn.close()
    return jsonify({'topic': topic})


@app.route('/api/admin/topic', methods=['POST'])
@admin_required
def admin_set_topic():
    data = request.json
    topic = data.get('topic', '').strip()
    if not topic:
        return jsonify({'error': '주제를 입력해주세요'}), 400
    if len(topic) > 50:
        return jsonify({'error': '주제는 50자 이내로 입력해주세요'}), 400
    conn = get_db()
    set_setting(conn, 'current_topic', topic)
    conn.commit()
    conn.close()
    return jsonify({'success': True, 'topic': topic, 'message': f'주제가 "{topic}"(으)로 설정되었습니다.'})


# -- Hall of Fame API --

@app.route('/api/hall-of-fame')
@login_required
def hall_of_fame():
    is_admin = 'admin_id' in session and session.get('admin_student_mode')
    student_id = 0 if is_admin else session.get('student_id', 0)
    conn = get_db()

    hall_reset_date = get_setting(conn, 'hall_reset_date', '2000-01-01')

    ranking = conn.execute('''
        SELECT s.id, s.grade, s.class_num, s.student_num, s.name,
               COUNT(q.id) as question_count
        FROM students s
        JOIN questions q ON s.id = q.student_id AND q.is_deleted = 0
                        AND q.created_date >= ?
        GROUP BY s.id
        ORDER BY question_count DESC, s.grade ASC, s.class_num ASC, s.student_num ASC
    ''', (hall_reset_date,)).fetchall()

    result = []
    rank = 1
    for i, r in enumerate(ranking):
        if i > 0 and r['question_count'] < ranking[i - 1]['question_count']:
            rank += 1
        result.append({
            'id': r['id'],
            'grade': r['grade'],
            'class_num': r['class_num'],
            'name': r['name'],
            'question_count': r['question_count'],
            'is_me': r['id'] == student_id,
            'rank': rank
        })

    conn.close()
    return jsonify({'ranking': result})


# -- Excel Export API --

@app.route('/api/admin/export/questions')
@admin_required
def export_questions():
    start_date = request.args.get('start', '2020-01-01')
    end_date = request.args.get('end', kst_today())

    conn = get_db()
    questions = conn.execute('''
        SELECT q.id, q.content, q.created_date, q.created_at,
               s.grade, s.class_num, s.student_num, s.name,
               COUNT(DISTINCT l.id) as like_count
        FROM questions q
        JOIN students s ON q.student_id = s.id
        LEFT JOIN likes l ON q.id = l.question_id
        WHERE q.created_date >= ? AND q.created_date <= ? AND q.is_deleted = 0
        GROUP BY q.id
        ORDER BY q.created_date DESC, q.created_at DESC
    ''', (start_date, end_date)).fetchall()
    conn.close()

    output = io.StringIO()
    output.write('\ufeff')
    writer = csv.writer(output)
    writer.writerow(['번호', '날짜', '학년', '반', '번호', '이름', '질문 내용', '좋아요 수', '작성시간'])

    for q in questions:
        writer.writerow([
            q['id'], q['created_date'], q['grade'], q['class_num'],
            q['student_num'], q['name'], q['content'],
            q['like_count'], q['created_at']
        ])

    output.seek(0)
    return Response(
        output.getvalue(),
        mimetype='text/csv',
        headers={
            'Content-Disposition': f'attachment; filename=questions_{start_date}_{end_date}.csv',
            'Content-Type': 'text/csv; charset=utf-8-sig'
        }
    )


@app.route('/api/admin/export/students')
@admin_required
def export_students():
    start_date = request.args.get('start', '2020-01-01')
    end_date = request.args.get('end', kst_today())

    conn = get_db()
    students = conn.execute('''
        SELECT s.grade, s.class_num, s.student_num, s.name,
               COUNT(DISTINCT q.id) as question_count,
               COUNT(DISTINCT l.id) as likes_received
        FROM students s
        LEFT JOIN questions q ON s.id = q.student_id AND q.is_deleted = 0
                                AND q.created_date >= ? AND q.created_date <= ?
        LEFT JOIN likes l ON q.id = l.question_id
        GROUP BY s.id
        ORDER BY s.grade, s.class_num, s.student_num
    ''', (start_date, end_date)).fetchall()
    conn.close()

    output = io.StringIO()
    output.write('\ufeff')
    writer = csv.writer(output)
    writer.writerow(['학년', '반', '번호', '이름', '질문 수', '받은 좋아요 수'])

    for s in students:
        writer.writerow([
            s['grade'], s['class_num'], s['student_num'],
            s['name'], s['question_count'], s['likes_received']
        ])

    output.seek(0)
    return Response(
        output.getvalue(),
        mimetype='text/csv',
        headers={
            'Content-Disposition': f'attachment; filename=students_{start_date}_{end_date}.csv',
            'Content-Type': 'text/csv; charset=utf-8-sig'
        }
    )


@app.route('/api/admin/export-db')
def export_db():
    if 'admin_id' not in session:
        return jsonify({'error': '관리자 로그인이 필요합니다'}), 401
    if not os.path.exists(DB_PATH):
        return jsonify({'error': 'DB 파일이 없습니다'}), 404
    conn = get_db()
    conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    conn.close()
    return send_from_directory(
        os.path.dirname(DB_PATH),
        os.path.basename(DB_PATH),
        as_attachment=True,
        download_name='questions.db'
    )


@app.route('/api/admin/import-db', methods=['POST'])
def import_db():
    if 'admin_id' not in session:
        return jsonify({'error': '관리자 로그인이 필요합니다'}), 401
    if 'file' not in request.files:
        return jsonify({'error': '파일이 없습니다'}), 400
    file = request.files['file']
    if not file.filename.endswith('.db'):
        return jsonify({'error': '.db 파일만 업로드 가능합니다'}), 400
    import tempfile, shutil
    with tempfile.NamedTemporaryFile(delete=False, suffix='.db') as tmp:
        file.save(tmp.name)
        try:
            test_conn = sqlite3.connect(tmp.name)
            test_conn.execute("SELECT count(*) FROM students")
            test_conn.execute("SELECT count(*) FROM questions")
            test_conn.close()
        except Exception:
            os.unlink(tmp.name)
            return jsonify({'error': '유효하지 않은 DB 파일입니다'}), 400
        os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
        shutil.move(tmp.name, DB_PATH)
    return jsonify({'success': True, 'message': 'DB를 성공적으로 가져왔습니다'})


init_db()

if __name__ == '__main__':
    print("=" * 50)
    print("  하루 한 개 질문 챌린지 서버 시작!")
    print("  http://localhost:3000")
    print("  관리자 페이지: http://localhost:3000/admin")
    print("  명예의 전당: http://localhost:3000/hall")
    print("  기본 관리자 계정: admin / admin123")
    print("=" * 50)
    app.run(host='0.0.0.0', port=3000, debug=True)
