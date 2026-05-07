// Helpers
async function api(url, options = {}) {
    const res = await fetch(url, {
        headers: { 'Content-Type': 'application/json' },
        ...options,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '오류가 발생했습니다');
    return data;
}

function showToast(message, type = 'success') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = `toast ${type} show`;
    setTimeout(() => toast.classList.remove('show'), 2500);
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

const gradeColors = ['#FF9B9B', '#FFE08A', '#7FE3FA', '#FFBEF7', '#89BFFF', '#C0BBFE'];

// Init
document.addEventListener('DOMContentLoaded', async () => {
    try {
        const data = await api('/api/admin/me');
        if (data.logged_in) {
            showDashboard();
        }
    } catch (e) {}

    setupAdminLogin();
    setupAdminLogout();
    setupDatePicker();
});

// Login
function setupAdminLogin() {
    document.getElementById('admin-login-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('admin-username').value;
        const password = document.getElementById('admin-password').value;

        try {
            await api('/api/admin/login', {
                method: 'POST',
                body: JSON.stringify({ username, password }),
            });
            showToast('관리자 로그인 성공');
            showDashboard();
        } catch (err) {
            showToast(err.message, 'error');
        }
    });
}

function setupAdminLogout() {
    document.getElementById('admin-logout-btn').addEventListener('click', async () => {
        await api('/api/admin/logout', { method: 'POST' });
        document.getElementById('admin-dashboard').style.display = 'none';
        document.getElementById('admin-login-screen').style.display = 'flex';
    });
}

function showDashboard() {
    document.getElementById('admin-login-screen').style.display = 'none';
    document.getElementById('admin-dashboard').style.display = 'block';

    const today = new Date().toISOString().split('T')[0];
    document.getElementById('admin-date').value = today;

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    document.getElementById('export-start').value = thirtyDaysAgo.toISOString().split('T')[0];
    document.getElementById('export-end').value = today;

    loadStats();
    loadAdminQuestions();
    loadStudents();
    setupStudentFilters();
    loadTopic();
}

// Feature 3: Enter student page as admin
async function enterStudentMode() {
    try {
        await api('/api/admin/student-mode', { method: 'POST' });
        window.location.href = '/';
    } catch (err) {
        showToast(err.message, 'error');
    }
}

// Date Picker
function setupDatePicker() {
    document.getElementById('admin-date').addEventListener('change', () => {
        loadAdminQuestions();
    });
}

// Stats
async function loadStats() {
    try {
        const data = await api('/api/admin/stats');

        document.getElementById('stat-students').textContent = data.total_students;
        document.getElementById('stat-questions').textContent = data.total_questions;
        document.getElementById('stat-today').textContent = data.today_questions;
        document.getElementById('stat-likes').textContent = data.total_likes;

        const maxQuestions = Math.max(...data.grade_stats.map(g => g.question_count), 1);
        document.getElementById('grade-stats').innerHTML = data.grade_stats.map((g, i) => `
            <div class="flex items-center gap-2.5 mb-2.5">
                <span class="text-sm font-bold min-w-[50px]">${g.grade}학년</span>
                <div class="flex-1 h-6 bg-[#F5EDE5] rounded-xl overflow-hidden">
                    <div class="h-full rounded-xl flex items-center pl-2.5 text-xs font-bold text-white min-w-fit grade-bar-fill" style="width: ${Math.max((g.question_count / maxQuestions) * 100, 5)}%; background: ${gradeColors[g.grade - 1]}">
                        ${g.question_count}개
                    </div>
                </div>
                <span class="text-xs text-txt-light min-w-[40px]">${g.student_count}명</span>
            </div>
        `).join('') || '<p class="text-txt-lighter text-sm">아직 데이터가 없어요</p>';

        document.getElementById('top-questions').innerHTML = data.top_questions.map((q, i) => `
            <div class="flex items-start gap-2.5 py-2.5 border-b border-[#F5EDE5] last:border-b-0">
                <span class="text-lg font-heading font-bold text-[#A04800] min-w-[30px]">${i + 1}</span>
                <div class="flex-1">
                    <div class="text-sm">${escapeHtml(q.content)}</div>
                    <div class="text-xs text-txt-light mt-0.5">${escapeHtml(q.author)}</div>
                </div>
                <div class="flex items-center gap-1 text-sm text-pastel-coral font-bold">
                    <span class="text-pastel-coral">\u2665</span> ${q.like_count}
                </div>
            </div>
        `).join('') || '<p class="text-txt-lighter text-sm">아직 좋아요가 없어요</p>';

    } catch (err) {
        showToast(err.message, 'error');
    }
}

// Questions Management
async function loadAdminQuestions() {
    const targetDate = document.getElementById('admin-date').value;
    try {
        const data = await api(`/api/admin/questions?date=${targetDate}`);
        const list = document.getElementById('admin-questions-list');

        if (data.questions.length === 0) {
            list.innerHTML = '<p class="text-txt-lighter text-center py-5 text-sm">이 날짜에 질문이 없어요</p>';
            return;
        }

        let html = `
            <div class="flex items-center gap-2.5 mb-3 px-3.5 py-2.5 bg-cream rounded-xl flex-wrap">
                <label class="flex items-center gap-1.5 cursor-pointer text-sm font-bold">
                    <input type="checkbox" id="select-all-questions" onchange="toggleSelectAll(this)" class="w-4 h-4 cursor-pointer"> 전체 선택
                </label>
                <span id="selected-count" class="text-xs text-txt-light">0개 선택</span>
                <div class="ml-auto flex gap-1.5">
                    <button class="bg-pastel-coral text-white border-none px-2.5 py-1.5 rounded-lg text-xs font-bold font-body cursor-pointer" onclick="bulkDeleteQuestions()">선택 삭제</button>
                    <button class="bg-pastel-green text-txt border-none px-2.5 py-1.5 rounded-lg text-xs font-bold font-body cursor-pointer" onclick="bulkRestoreQuestions()">선택 복원</button>
                </div>
            </div>
        `;

        html += data.questions.map(q => `
            <div class="flex items-center gap-3 px-3 py-3 rounded-xl border-b border-[#F5EDE5] last:border-b-0 hover:bg-cream transition ${q.is_deleted ? 'opacity-50 line-through' : ''}" id="admin-q-${q.id}">
                <input type="checkbox" class="question-checkbox w-4 h-4 cursor-pointer flex-shrink-0" value="${q.id}" onchange="updateSelectedCount()">
                <div class="flex-1 min-w-0">
                    <div class="text-sm">${escapeHtml(q.content)}</div>
                    <div class="text-xs text-txt-light mt-0.5">
                        ${escapeHtml(q.author)} &middot; <span class="text-pastel-coral">\u2665</span> ${q.like_count}
                        ${q.is_deleted ? ' &middot; <span class="text-pastel-coral font-bold">삭제됨</span>' : ''}
                    </div>
                </div>
                ${q.is_deleted
                    ? `<button class="bg-pastel-green text-txt border-none px-2.5 py-1.5 rounded-lg text-xs font-bold font-body cursor-pointer whitespace-nowrap" onclick="restoreQuestion(${q.id})">복원</button>`
                    : `<button class="bg-pastel-coral text-white border-none px-2.5 py-1.5 rounded-lg text-xs font-bold font-body cursor-pointer whitespace-nowrap" onclick="deleteQuestion(${q.id})">삭제</button>`
                }
            </div>
        `).join('');

        list.innerHTML = html;

    } catch (err) {
        showToast(err.message, 'error');
    }
}

function toggleSelectAll(checkbox) {
    document.querySelectorAll('.question-checkbox').forEach(cb => {
        cb.checked = checkbox.checked;
    });
    updateSelectedCount();
}

function updateSelectedCount() {
    const checked = document.querySelectorAll('.question-checkbox:checked').length;
    const countEl = document.getElementById('selected-count');
    if (countEl) countEl.textContent = `${checked}개 선택`;
}

function getSelectedIds() {
    return Array.from(document.querySelectorAll('.question-checkbox:checked')).map(cb => parseInt(cb.value));
}

async function bulkDeleteQuestions() {
    const ids = getSelectedIds();
    if (ids.length === 0) { showToast('삭제할 질문을 선택해주세요', 'error'); return; }
    if (!confirm(`선택한 ${ids.length}개의 질문을 삭제할까요?`)) return;
    try {
        const data = await api('/api/admin/questions/bulk-delete', { method: 'POST', body: JSON.stringify({ ids }) });
        showToast(data.message);
        loadAdminQuestions();
        loadStats();
    } catch (err) { showToast(err.message, 'error'); }
}

async function bulkRestoreQuestions() {
    const ids = getSelectedIds();
    if (ids.length === 0) { showToast('복원할 질문을 선택해주세요', 'error'); return; }
    if (!confirm(`선택한 ${ids.length}개의 질문을 복원할까요?`)) return;
    try {
        const data = await api('/api/admin/questions/bulk-restore', { method: 'POST', body: JSON.stringify({ ids }) });
        showToast(data.message);
        loadAdminQuestions();
        loadStats();
    } catch (err) { showToast(err.message, 'error'); }
}

async function deleteQuestion(id) {
    if (!confirm('이 질문을 삭제할까요?')) return;
    try {
        await api(`/api/admin/questions/${id}`, { method: 'DELETE' });
        showToast('질문이 삭제되었습니다');
        loadAdminQuestions();
        loadStats();
    } catch (err) { showToast(err.message, 'error'); }
}

async function restoreQuestion(id) {
    try {
        await api(`/api/admin/questions/${id}/restore`, { method: 'POST' });
        showToast('질문이 복원되었습니다');
        loadAdminQuestions();
        loadStats();
    } catch (err) { showToast(err.message, 'error'); }
}

// Hall of Fame Reset
async function resetHallOfFame() {
    if (!confirm('명예의 전당 순위를 초기화할까요?\n오늘부터 새로 집계가 시작됩니다.\n(기존 질문과 좋아요는 유지됩니다.)')) return;
    try {
        const data = await api('/api/admin/reset-hall', { method: 'POST' });
        showToast(data.message);
        loadStats();
    } catch (err) { showToast(err.message, 'error'); }
}

// Student Management
let allStudents = [];

function setupStudentFilters() {
    document.getElementById('filter-role').addEventListener('change', renderStudents);
    document.getElementById('filter-grade').addEventListener('change', renderStudents);
    document.getElementById('filter-name').addEventListener('input', renderStudents);
}

async function loadStudents() {
    try {
        const data = await api('/api/admin/students');
        allStudents = data.students;
        renderStudents();
    } catch (err) { console.error(err); }
}

function renderStudents() {
    const roleFilter = document.getElementById('filter-role').value;
    const gradeFilter = document.getElementById('filter-grade').value;
    const nameFilter = document.getElementById('filter-name').value.trim().toLowerCase();
    const list = document.getElementById('student-list');

    let filtered = allStudents;
    if (roleFilter) filtered = filtered.filter(s => (s.role || 'student') === roleFilter);
    if (gradeFilter) filtered = filtered.filter(s => s.grade == gradeFilter);
    if (nameFilter) filtered = filtered.filter(s => s.name.toLowerCase().includes(nameFilter));

    if (filtered.length === 0) {
        list.innerHTML = '<p class="text-txt-lighter text-center py-5 text-sm">해당하는 학생이 없습니다</p>';
        return;
    }

    list.innerHTML = filtered.map(s => {
        let pinDisplay;
        if (s.pin) {
            pinDisplay = `<span class="text-pastel-green font-bold font-mono text-sm tracking-widest">${s.pin}</span>`;
        } else if (s.has_pin && !s.pin_viewable) {
            pinDisplay = '<span class="text-pastel-coral">확인불가 (재설정 필요)</span>';
        } else {
            pinDisplay = '<span class="text-pastel-coral">미설정</span>';
        }

        const totalQ = s.total_question_count;
        const extraQ = s.extra_question_count;
        let qDisplay = `질문 ${totalQ}개`;
        if (extraQ !== 0) {
            qDisplay += ` <span class="text-pastel-purple">(실제 ${s.question_count} ${extraQ > 0 ? '+' : ''}${extraQ})</span>`;
        }

        const isTeacher = s.role === 'teacher';
        const roleBadge = isTeacher
            ? '<span class="text-[10px] font-bold bg-pastel-sky text-white px-1.5 py-0.5 rounded ml-1">교직원</span>'
            : '<span class="text-[10px] font-bold bg-pastel-green text-white px-1.5 py-0.5 rounded ml-1">학생</span>';
        const roleToggleLabel = isTeacher ? '학생으로' : '교직원으로';
        const nameDisplay = isTeacher
            ? `${escapeHtml(s.name)} 선생님`
            : `${s.grade}-${s.class_num} ${escapeHtml(s.name)} (${s.student_num}번)`;
        const avatarClass = isTeacher ? 'bg-pastel-sky' : `grade-${s.grade}`;
        const avatarText = isTeacher ? 'T' : s.grade;

        return `
        <div class="flex items-center gap-3 px-3 py-3 rounded-xl border-b border-[#F5EDE5] last:border-b-0 hover:bg-cream transition">
            <input type="checkbox" class="student-checkbox w-4 h-4 cursor-pointer flex-shrink-0" value="${s.id}" onchange="updatePinSelectedCount()">
            <div class="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold text-white flex-shrink-0 ${avatarClass}">
                ${avatarText}
            </div>
            <div class="flex-1 min-w-0">
                <div class="text-sm font-bold">
                    ${nameDisplay}${roleBadge}
                    <button class="bg-pastel-sky text-white border-none px-1.5 py-0.5 rounded text-[10px] font-bold font-body cursor-pointer ml-1 hover:opacity-80" onclick="renameStudent(${s.id}, '${escapeHtml(s.name).replace(/'/g, "\\'")}')">이름수정</button>
                    <button class="bg-[#A0A0A0] text-white border-none px-1.5 py-0.5 rounded text-[10px] font-bold font-body cursor-pointer ml-0.5 hover:opacity-80" onclick="changeRole(${s.id}, '${escapeHtml(s.name).replace(/'/g, "\\'")}', '${s.role}')">${roleToggleLabel}</button>
                </div>
                <div class="text-xs text-txt-light">
                    ${qDisplay}
                    <button class="bg-pastel-purple text-white border-none px-1.5 py-0.5 rounded text-[10px] font-bold font-body cursor-pointer ml-1 hover:opacity-80" onclick="editQuestionCount(${s.id}, '${escapeHtml(s.name).replace(/'/g, "\\'")}', ${totalQ})">수정</button>
                    &middot; 비밀번호: ${pinDisplay}
                </div>
            </div>
            <div class="flex gap-1">
                ${s.has_pin ? `<button class="bg-pastel-orange text-white border-none px-2 py-1.5 rounded-lg text-xs font-bold font-body cursor-pointer whitespace-nowrap" onclick="resetStudentPin(${s.id}, '${nameDisplay}')">PIN 초기화</button>` : ''}
                <button class="bg-red-400 text-white border-none px-2 py-1.5 rounded-lg text-xs font-bold font-body cursor-pointer whitespace-nowrap" onclick="deleteStudent(${s.id}, '${nameDisplay}')">삭제</button>
            </div>
        </div>`;
    }).join('');

    const selectAllEl = document.getElementById('select-all-students');
    if (selectAllEl) selectAllEl.checked = false;
    updatePinSelectedCount();
}

// Feature 2: Delete student account
async function deleteStudent(studentId, studentName) {
    if (!confirm(`${studentName} 학생의 계정을 삭제할까요?\n해당 학생의 모든 질문과 좋아요가 삭제됩니다.\n이 작업은 되돌릴 수 없습니다.`)) return;
    if (!confirm(`정말로 삭제하시겠습니까?`)) return;
    try {
        const data = await api(`/api/admin/students/${studentId}`, { method: 'DELETE' });
        showToast(data.message);
        loadStudents();
        loadStats();
    } catch (err) { showToast(err.message, 'error'); }
}

async function renameStudent(studentId, currentName) {
    const newName = prompt(`'${currentName}' 학생의 새 이름을 입력하세요:`, currentName);
    if (!newName || newName.trim() === '' || newName.trim() === currentName) return;
    try {
        const data = await api(`/api/admin/students/${studentId}/rename`, {
            method: 'POST',
            body: JSON.stringify({ name: newName.trim() }),
        });
        showToast(data.message);
        loadStudents();
        loadStats();
    } catch (err) { showToast(err.message, 'error'); }
}

async function editQuestionCount(studentId, studentName, currentCount) {
    const newCount = prompt(`'${studentName}' 학생의 질문 수를 입력하세요:\n(명예의 전당에 반영됩니다)`, currentCount);
    if (newCount === null || newCount.trim() === '') return;
    const count = parseInt(newCount.trim());
    if (isNaN(count) || count < 0) { showToast('0 이상의 숫자를 입력해주세요', 'error'); return; }
    if (count === currentCount) return;
    try {
        const data = await api(`/api/admin/students/${studentId}/update-question-count`, {
            method: 'POST',
            body: JSON.stringify({ question_count: count }),
        });
        showToast(data.message);
        loadStudents();
        loadStats();
    } catch (err) { showToast(err.message, 'error'); }
}

async function changeRole(studentId, name, currentRole) {
    const newRole = currentRole === 'teacher' ? 'student' : 'teacher';
    const body = { role: newRole };

    if (newRole === 'teacher') {
        if (!confirm(`'${name}'님을 교직원으로 변경할까요?\n질문에 표시되는 정보가 '선생님'으로 바뀝니다.`)) return;
    } else {
        const info = prompt(`'${name}'님을 학생으로 변경합니다.\n학년, 반, 번호를 입력하세요.\n(예: 3,2,15)`, '');
        if (!info) return;
        const parts = info.split(',').map(s => s.trim());
        if (parts.length !== 3 || parts.some(p => !p || isNaN(p))) {
            showToast('학년, 반, 번호를 쉼표로 구분하여 입력해주세요 (예: 3,2,15)', 'error');
            return;
        }
        body.grade = parseInt(parts[0]);
        body.class_num = parseInt(parts[1]);
        body.student_num = parseInt(parts[2]);
    }

    try {
        const data = await api(`/api/admin/students/${studentId}/change-role`, {
            method: 'POST',
            body: JSON.stringify(body),
        });
        showToast(data.message);
        loadStudents();
        loadStats();
    } catch (err) { showToast(err.message, 'error'); }
}

function toggleSelectAllStudents(checkbox) {
    document.querySelectorAll('.student-checkbox').forEach(cb => {
        cb.checked = checkbox.checked;
    });
    updatePinSelectedCount();
}

function updatePinSelectedCount() {
    const checked = document.querySelectorAll('.student-checkbox:checked').length;
    const countEl = document.getElementById('pin-selected-count');
    if (countEl) countEl.textContent = `${checked}명 선택`;
}

function getSelectedStudentIds() {
    return Array.from(document.querySelectorAll('.student-checkbox:checked')).map(cb => parseInt(cb.value));
}

async function setCustomPins() {
    const ids = getSelectedStudentIds();
    const pin = document.getElementById('custom-pin').value.trim();

    if (ids.length === 0) { showToast('비밀번호를 설정할 학생을 선택해주세요', 'error'); return; }
    if (!pin || pin.length !== 4 || !/^\d{4}$/.test(pin)) { showToast('비밀번호는 숫자 4자리로 입력해주세요', 'error'); return; }
    if (!confirm(`선택한 ${ids.length}명의 비밀번호를 '${pin}'으로 설정할까요?`)) return;

    try {
        const data = await api('/api/admin/set-pins', {
            method: 'POST',
            body: JSON.stringify({ student_ids: ids, pin: pin }),
        });
        showToast(data.message);
        document.getElementById('custom-pin').value = '';
        document.querySelectorAll('.student-checkbox').forEach(cb => cb.checked = false);
        const selectAllEl = document.getElementById('select-all-students');
        if (selectAllEl) selectAllEl.checked = false;
        updatePinSelectedCount();
        loadStudents();
    } catch (err) { showToast(err.message, 'error'); }
}

async function resetStudentPin(studentId, studentName) {
    if (!confirm(`${studentName} 학생의 비밀번호를 초기화할까요?\n학생이 다시 로그인하면 새 비밀번호를 설정하게 됩니다.`)) return;
    try {
        const data = await api(`/api/admin/reset-pin/${studentId}`, { method: 'POST' });
        showToast(data.message);
        loadStudents();
    } catch (err) { showToast(err.message, 'error'); }
}

// Bulk PIN Generation
async function generatePins(target) {
    const msg = target === 'all'
        ? '모든 학생의 비밀번호를 새로 생성합니다.\n기존 비밀번호가 변경됩니다. 계속할까요?'
        : '비밀번호가 없는 학생들에게 비밀번호를 생성합니다. 계속할까요?';

    if (!confirm(msg)) return;
    if (target === 'all' && !confirm('[주의] 정말로 모든 학생의 비밀번호를 변경하시겠습니까?')) return;

    try {
        const data = await api('/api/admin/generate-pins', {
            method: 'POST',
            body: JSON.stringify({ target }),
        });
        showToast(data.message);
        loadStudents();
    } catch (err) { showToast(err.message, 'error'); }
}

// Topic
async function loadTopic() {
    try {
        const data = await api('/api/admin/topic');
        document.getElementById('topic-input').value = data.topic || '';
    } catch (err) { console.error('주제 로드 실패:', err); }
}

async function saveTopic() {
    const topic = document.getElementById('topic-input').value.trim();
    if (!topic) { showToast('주제를 입력해주세요', 'error'); return; }
    try {
        const data = await api('/api/admin/topic', { method: 'POST', body: JSON.stringify({ topic }) });
        showToast(data.message);
    } catch (err) { showToast(err.message, 'error'); }
}

// DB Import
async function importDb(input) {
    if (!input.files.length) return;
    if (!confirm('기존 데이터가 모두 교체됩니다. 계속하시겠습니까?')) {
        input.value = '';
        return;
    }
    const status = document.getElementById('import-status');
    status.className = 'mt-2 text-sm font-bold text-txt-light';
    status.textContent = '업로드 중...';
    try {
        const form = new FormData();
        form.append('file', input.files[0]);
        const res = await fetch('/api/admin/import-db', { method: 'POST', body: form });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        status.className = 'mt-2 text-sm font-bold text-pastel-green';
        status.textContent = data.message;
        showToast(data.message);
        setTimeout(() => location.reload(), 1000);
    } catch (err) {
        status.className = 'mt-2 text-sm font-bold text-pastel-coral';
        status.textContent = err.message;
        showToast(err.message, 'error');
    }
    input.value = '';
}

// Excel Download
function downloadExcel(type) {
    const startDate = document.getElementById('export-start').value;
    const endDate = document.getElementById('export-end').value;

    if (!startDate || !endDate) { showToast('시작일과 종료일을 선택해주세요', 'error'); return; }
    if (startDate > endDate) { showToast('시작일이 종료일보다 이후입니다', 'error'); return; }

    const url = `/api/admin/export/${type}?start=${startDate}&end=${endDate}`;
    window.location.href = url;
    showToast('다운로드를 시작합니다!');
}
