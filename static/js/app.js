// State
let currentDate = getLocalToday();
let currentSort = 'latest';
let currentGradeFilter = '';
let currentPage = 1;
let isAdminMode = false;
let isTeacherMode = false;
let currentRole = 'student';

// Helpers
function getLocalToday() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function toLocalDateString(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function api(url, options = {}) {
    const res = await fetch(url, {
        headers: { 'Content-Type': 'application/json' },
        ...options,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'API 요청 중 오류가 발생했습니다');
    return data;
}

function showToast(message, type = 'success') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = `toast ${type} show`;
    setTimeout(() => toast.classList.remove('show'), 2500);
}

function formatDate(dateStr) {
    const parts = dateStr.split('-');
    const d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
    const days = ['일', '월', '화', '수', '목', '금', '토'];
    const month = d.getMonth() + 1;
    const day = d.getDate();
    const dayName = days[d.getDay()];
    return `${month}월 ${day}일 (${dayName})`;
}

function formatTime(timestamp) {
    const d = new Date(timestamp + 'Z');
    const h = d.getHours();
    const m = String(d.getMinutes()).padStart(2, '0');
    const period = h < 12 ? '오전' : '오후';
    const hour = h % 12 || 12;
    return `${period} ${hour}:${m}`;
}

function isToday(dateStr) {
    return dateStr === getLocalToday();
}

function addDays(dateStr, days) {
    const parts = dateStr.split('-');
    const d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
    d.setDate(d.getDate() + days);
    return toLocalDateString(d);
}

// Init
document.addEventListener('DOMContentLoaded', async () => {
    try {
        const data = await api('/api/me');
        if (data.logged_in) {
            isAdminMode = !!data.is_admin;
            isTeacherMode = data.role === 'teacher';
            if (isTeacherMode) {
                showMainScreen(data.teacher, 'teacher');
            } else {
                showMainScreen(data.student);
            }
        }
    } catch (e) {}

    setupLoginForm();
    setupQuestionForm();
    setupSortButtons();
    setupGradeFilter();  // Feature 1
    setupDateNavigation();
    setupLogout();
    setupPastDates();
    setupHomeButton();
    setupAdminModeExit();  // Feature 3
    updateDateDisplay();
    loadTopicOnLogin();  // Load topic on login screen too

    setInterval(() => {
        if (document.getElementById('main-screen').style.display !== 'none') {
            loadQuestions();
        }
    }, 30000);

    document.addEventListener('visibilitychange', () => {
        if (!document.hidden && document.getElementById('main-screen').style.display !== 'none') {
            loadQuestions();
            loadTopic();
        }
    });
});

// Login
let loginStep = 'info';

function switchRole(role) {
    currentRole = role;
    loginStep = 'info';
    document.getElementById('pin-section').style.display = 'none';
    document.getElementById('pin').value = '';

    const studentBtn = document.getElementById('role-student-btn');
    const teacherBtn = document.getElementById('role-teacher-btn');
    const studentFields = document.getElementById('student-fields');
    const teacherFields = document.getElementById('teacher-fields');

    if (role === 'student') {
        studentBtn.className = 'flex-1 py-2.5 text-sm font-heading font-bold rounded-lg transition-all bg-gradient-to-r from-pastel-orange to-pastel-coral text-white shadow';
        teacherBtn.className = 'flex-1 py-2.5 text-sm font-heading font-bold rounded-lg transition-all text-txt-light hover:text-txt';
        studentFields.style.display = 'block';
        teacherFields.style.display = 'none';
        document.getElementById('grade').required = true;
        document.getElementById('class_num').required = true;
        document.getElementById('student_num').required = true;
        document.getElementById('name').required = true;
    } else {
        teacherBtn.className = 'flex-1 py-2.5 text-sm font-heading font-bold rounded-lg transition-all bg-gradient-to-r from-pastel-sky to-pastel-purple text-white shadow';
        studentBtn.className = 'flex-1 py-2.5 text-sm font-heading font-bold rounded-lg transition-all text-txt-light hover:text-txt';
        studentFields.style.display = 'none';
        teacherFields.style.display = 'block';
        document.getElementById('grade').required = false;
        document.getElementById('class_num').required = false;
        document.getElementById('student_num').required = false;
        document.getElementById('name').required = false;
    }

    document.getElementById('login-btn').textContent = '다음';
}

function setupLoginForm() {
    document.getElementById('login-form').addEventListener('submit', async (e) => {
        e.preventDefault();

        if (currentRole === 'teacher') {
            await handleTeacherLogin();
            return;
        }

        const grade = document.getElementById('grade').value;
        const class_num = document.getElementById('class_num').value;
        const student_num = document.getElementById('student_num').value;
        const name = document.getElementById('name').value.trim();
        const pin = document.getElementById('pin').value.trim();

        if (!grade || !class_num || !student_num || !name) {
            showToast('필수 항목을 입력해주세요', 'error');
            return;
        }

        if (loginStep !== 'info' && !pin) {
            showToast('비밀번호(4자리 숫자)를 입력해주세요', 'error');
            document.getElementById('pin').focus();
            return;
        }

        if (loginStep !== 'info' && (pin.length !== 4 || !/^\d{4}$/.test(pin))) {
            showToast('비밀번호는 4자리 숫자여야 합니다', 'error');
            return;
        }

        try {
            const body = { grade, class_num, student_num, name };
            if (pin) body.pin = pin;

            const res = await fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            const data = await res.json();

            if (data.need_pin_setup) {
                loginStep = 'pin_setup';
                showPinSection('비밀번호 설정 (4자리 숫자)', '향후 로그인할 때 사용할 비밀번호를 설정하세요.', '설정하기');
                document.getElementById('pin').focus();
                return;
            }

            if (data.need_pin) {
                loginStep = 'pin_enter';
                showPinSection('비밀번호 (4자리 숫자)', '비밀번호를 입력하세요', '로그인');
                document.getElementById('pin').focus();
                return;
            }

            if (!res.ok) {
                throw new Error(data.error || 'API 요청 중 오류가 발생했습니다');
            }

            if (data.success) {
                showToast(`${name}님, 환영합니다!`);
                resetLoginForm();
                isAdminMode = false;
                isTeacherMode = false;
                showMainScreen(data.student);
            }
        } catch (err) {
            showToast(err.message, 'error');
            if (loginStep === 'pin_enter') {
                document.getElementById('pin').value = '';
                document.getElementById('pin').focus();
            }
        }
    });
}

async function handleTeacherLogin() {
    const name = document.getElementById('teacher-name').value.trim();
    const pin = document.getElementById('pin').value.trim();

    if (!name) {
        showToast('이름을 입력해주세요', 'error');
        return;
    }

    if (loginStep !== 'info' && !pin) {
        showToast('비밀번호(4자리 숫자)를 입력해주세요', 'error');
        document.getElementById('pin').focus();
        return;
    }

    if (loginStep !== 'info' && (pin.length !== 4 || !/^\d{4}$/.test(pin))) {
        showToast('비밀번호는 4자리 숫자여야 합니다', 'error');
        return;
    }

    try {
        const body = { name };
        if (pin) body.pin = pin;

        const res = await fetch('/api/teacher/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        const data = await res.json();

        if (data.need_pin_setup) {
            loginStep = 'pin_setup';
            showPinSection('비밀번호 설정 (4자리 숫자)', '향후 로그인할 때 사용할 비밀번호를 설정하세요.', '설정하기');
            document.getElementById('pin').focus();
            return;
        }

        if (data.need_pin) {
            loginStep = 'pin_enter';
            showPinSection('비밀번호 (4자리 숫자)', '비밀번호를 입력하세요', '로그인');
            document.getElementById('pin').focus();
            return;
        }

        if (!res.ok) {
            throw new Error(data.error || 'API 요청 중 오류가 발생했습니다');
        }

        if (data.success) {
            showToast(`${name} 선생님, 환영합니다!`);
            resetLoginForm();
            isAdminMode = false;
            isTeacherMode = true;
            showMainScreen(data.teacher, 'teacher');
        }
    } catch (err) {
        showToast(err.message, 'error');
        if (loginStep === 'pin_enter') {
            document.getElementById('pin').value = '';
            document.getElementById('pin').focus();
        }
    }
}

function showPinSection(label, hint, btnText) {
    document.getElementById('pin-section').style.display = 'block';
    document.getElementById('pin-label').textContent = label;
    document.getElementById('pin-hint').textContent = hint;
    document.getElementById('login-btn').textContent = btnText;
    if (currentRole === 'student') {
        document.getElementById('grade').disabled = true;
        document.getElementById('class_num').readOnly = true;
        document.getElementById('student_num').readOnly = true;
        document.getElementById('name').readOnly = true;
    } else {
        document.getElementById('teacher-name').readOnly = true;
    }
    document.getElementById('role-student-btn').disabled = true;
    document.getElementById('role-teacher-btn').disabled = true;
}

function resetLoginForm() {
    loginStep = 'info';
    document.getElementById('pin-section').style.display = 'none';
    document.getElementById('pin').value = '';
    document.getElementById('login-btn').textContent = '다음';
    document.getElementById('grade').disabled = false;
    document.getElementById('class_num').readOnly = false;
    document.getElementById('student_num').readOnly = false;
    document.getElementById('name').readOnly = false;
    document.getElementById('teacher-name').readOnly = false;
    document.getElementById('role-student-btn').disabled = false;
    document.getElementById('role-teacher-btn').disabled = false;
}

function showMainScreen(user, role = 'student') {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('main-screen').style.display = 'block';

    if (isAdminMode) {
        document.getElementById('user-info').textContent = '관리자';
        document.getElementById('admin-mode-banner').style.display = 'block';
        document.getElementById('question-form-container').style.display = 'none';
    } else if (role === 'teacher' || isTeacherMode) {
        document.getElementById('user-info').textContent = `${user.name}`;
        document.getElementById('admin-mode-banner').style.display = 'none';
        document.getElementById('question-form-container').style.display = 'none';
    } else {
        document.getElementById('user-info').textContent =
            `${user.grade}-${user.class_num} ${user.name}`;
        document.getElementById('admin-mode-banner').style.display = 'none';
    }

    currentDate = getLocalToday();
    updateDateDisplay();
    loadQuestions();
    loadTopic();
}

// Feature 3: Admin mode exit
function setupAdminModeExit() {
    const btn = document.getElementById('exit-admin-mode-btn');
    if (btn) {
        btn.addEventListener('click', async () => {
            try {
                await api('/api/admin/exit-student-mode', { method: 'POST' });
                window.location.href = '/admin';
            } catch (err) {
                window.location.href = '/admin';
            }
        });
    }
}

// Topic - show on login screen (no auth needed)
async function loadTopicOnLogin() {
    try {
        const data = await api('/api/topic');
        const loginTopic = document.getElementById('login-topic');
        const loginTopicName = document.getElementById('login-topic-name');
        if (data.topic && loginTopic && loginTopicName) {
            loginTopicName.textContent = data.topic;
            loginTopic.style.display = 'block';
        }
    } catch (err) {}
}

// Topic - show on main screen
async function loadTopic() {
    try {
        const data = await api('/api/topic');
        const banner = document.getElementById('topic-banner');
        const topicHint = document.getElementById('topic-hint');
        if (data.topic) {
            document.getElementById('topic-name').textContent = data.topic;
            banner.style.display = 'block';
            if (topicHint) {
                topicHint.textContent = `이번 주제: ${data.topic}`;
                topicHint.style.display = 'block';
            }
        } else {
            banner.style.display = 'none';
            if (topicHint) topicHint.style.display = 'none';
        }
    } catch (err) {
        console.error('토픽 로드 중 오류:', err);
    }
}

// Logout
function setupLogout() {
    document.getElementById('logout-btn').addEventListener('click', async () => {
        await api('/api/logout', { method: 'POST' });
        isAdminMode = false;
        isTeacherMode = false;
        currentRole = 'student';
        document.getElementById('main-screen').style.display = 'none';
        document.getElementById('admin-mode-banner').style.display = 'none';
        document.getElementById('login-screen').style.display = 'block';
        document.getElementById('login-form').reset();
        resetLoginForm();
        switchRole('student');
    });
}

// Home Button
function setupHomeButton() {
    document.getElementById('home-btn').addEventListener('click', () => {
        currentDate = getLocalToday();
        updateDateDisplay();
        loadQuestions();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });
}

// Question Form
function setupQuestionForm() {
    const textarea = document.getElementById('question-content');
    const charCount = document.getElementById('char-count');

    textarea.addEventListener('input', () => {
        charCount.textContent = `${textarea.value.length}/200`;
        if (textarea.value.length >= 180) {
            charCount.style.color = '#E07070';
        } else {
            charCount.style.color = '';
        }
    });

    document.getElementById('question-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const content = textarea.value.trim();
        if (!content) {
            showToast('질문을 입력해주세요', 'error');
            return;
        }

        try {
            const data = await api('/api/questions', {
                method: 'POST',
                body: JSON.stringify({ content }),
            });
            showToast(data.message);
            textarea.value = '';
            charCount.textContent = '0/200';
            loadQuestions();
        } catch (err) {
            showToast(err.message, 'error');
        }
    });
}

// Feature 1: Grade Filter
function setupGradeFilter() {
    document.querySelectorAll('.grade-filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.grade-filter-btn').forEach(b => {
                b.classList.remove('active', 'bg-gradient-to-r', 'from-pastel-orange', 'to-pastel-coral', '!text-white', '!border-transparent');
                b.classList.add('bg-white', 'text-txt-light');
            });
            btn.classList.add('active', 'bg-gradient-to-r', 'from-pastel-orange', 'to-pastel-coral', '!text-white', '!border-transparent');
            btn.classList.remove('bg-white', 'text-txt-light');
            currentGradeFilter = btn.dataset.grade;
            currentPage = 1;
            loadQuestions();
        });
    });

    // Set initial active
    const activeBtn = document.querySelector('.grade-filter-btn.active');
    if (activeBtn) {
        activeBtn.classList.add('bg-gradient-to-r', 'from-pastel-orange', 'to-pastel-coral', '!text-white', '!border-transparent');
        activeBtn.classList.remove('bg-white', 'text-txt-light');
    }
}

// Load Questions
async function loadQuestions() {
    try {
        let url = `/api/questions?date=${currentDate}&sort=${currentSort}&page=${currentPage}`;
        if (currentGradeFilter) {
            url += `&grade=${currentGradeFilter}`;
        }
        const data = await api(url);

        const formContainer = document.getElementById('question-form-container');
        const alreadyPosted = document.getElementById('already-posted');
        const today = isToday(currentDate);

        if (isAdminMode || isTeacherMode) {
            formContainer.style.display = 'none';
            alreadyPosted.style.display = 'none';
        } else if (!today) {
            formContainer.style.display = 'none';
            alreadyPosted.style.display = 'none';
        } else if (data.already_posted_today) {
            formContainer.style.display = 'none';
            alreadyPosted.style.display = 'block';
        } else {
            formContainer.style.display = 'block';
            alreadyPosted.style.display = 'none';
        }

        const list = document.getElementById('questions-list');
        const empty = document.getElementById('empty-state');
        const countBadge = document.getElementById('question-count');

        countBadge.textContent = `${data.total_count}개`;

        if (data.questions.length === 0) {
            list.innerHTML = '';
            empty.style.display = 'block';
            return;
        }

        empty.style.display = 'none';
        list.innerHTML = data.questions.map((q, i) => {
            const canEdit = q.can_edit || q.is_mine;
            const isAuthorTeacher = q.author_role === 'teacher';
            const avatarHtml = isAuthorTeacher
                ? `<div class="h-8 px-2.5 rounded-full flex items-center justify-center text-[11px] font-bold text-white bg-pastel-sky whitespace-nowrap">선생님</div>`
                : `<div class="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold text-white grade-${q.grade}">${q.grade}</div>`;
            return `
            <div class="bg-white rounded-2xl shadow-md p-4 transition-all hover:shadow-lg border border-[#FFE8CC]/30 animate-slideUp ${q.is_mine ? 'border-l-4 border-l-pastel-orange bg-cream' : ''} ${isAdminMode && !q.is_mine ? 'border-l-4 border-l-red-300' : ''}" style="animation-delay: ${i * 0.05}s" id="question-card-${q.id}">
                <div class="flex items-center justify-between mb-2.5">
                    <div class="flex items-center gap-2">
                        ${avatarHtml}
                        <div class="flex flex-col">
                            <span class="text-sm font-bold">${escapeHtml(q.author)}</span>
                            <span class="text-xs text-txt-lighter">${formatTime(q.created_at)}</span>
                        </div>
                    </div>
                    ${canEdit ? `
                    <div class="flex items-center gap-1">
                        <button class="px-2.5 py-1 rounded-lg text-xs font-bold border border-[#FFD0A0] text-txt-light bg-white hover:border-pastel-orange hover:text-pastel-orange transition" onclick="startEditQuestion(${q.id}, this)">수정</button>
                        <button class="px-2.5 py-1 rounded-lg text-xs font-bold border border-pastel-coral/40 text-pastel-coral bg-white hover:bg-red-50 transition" onclick="deleteMyQuestion(${q.id})">삭제</button>
                    </div>` : ''}
                </div>
                <div class="question-content-${q.id} text-base leading-relaxed mb-3 break-words">${escapeHtml(q.content)}</div>
                <div class="flex items-center gap-3">
                    <button class="like-btn inline-flex items-center gap-1.5 px-4 py-1.5 border-2 rounded-full text-sm font-semibold cursor-pointer transition-all
                        ${q.liked_by_me
                            ? 'border-pastel-coral text-pastel-coral bg-red-50'
                            : 'border-[#FFD0A0] text-txt-light bg-white hover:border-pastel-coral hover:text-pastel-coral hover:bg-red-50'}"
                        onclick="toggleLike(${q.id}, this)" ${(isAdminMode || isTeacherMode) ? 'disabled' : ''}>
                        <span class="heart text-base transition-transform ${q.liked_by_me ? 'text-pastel-coral' : 'text-txt-lighter'}">&#9829;</span>
                        <span class="like-count">${q.like_count}</span>
                    </button>
                </div>
            </div>`;
        }).join('');

        renderPagination(data.page, data.total_pages, data.total_count);

    } catch (err) {
        showToast(err.message, 'error');
    }
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function goToPage(page) {
    currentPage = page;
    loadQuestions();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderPagination(page, totalPages, totalCount) {
    const container = document.getElementById('pagination');
    if (!container) return;
    if (totalPages <= 1) {
        container.innerHTML = '';
        return;
    }

    const buttons = [];
    const btnBase = 'w-9 h-9 rounded-full text-sm font-bold transition-all flex items-center justify-center';
    const btnActive = `${btnBase} bg-gradient-to-r from-pastel-orange to-pastel-coral text-white shadow`;
    const btnNormal = `${btnBase} bg-white border-2 border-[#FFD0A0] text-txt-light hover:border-pastel-orange hover:text-pastel-orange`;
    const btnDisabled = `${btnBase} bg-gray-100 text-gray-300 cursor-not-allowed border border-gray-200`;

    buttons.push(`<button class="${page === 1 ? btnDisabled : btnNormal}" ${page === 1 ? 'disabled' : `onclick="goToPage(${page - 1})"`}>&lsaquo;</button>`);

    let start = Math.max(1, page - 2);
    let end = Math.min(totalPages, start + 4);
    start = Math.max(1, end - 4);

    if (start > 1) {
        buttons.push(`<button class="${btnNormal}" onclick="goToPage(1)">1</button>`);
        if (start > 2) buttons.push(`<span class="text-txt-lighter text-xs px-1">...</span>`);
    }

    for (let i = start; i <= end; i++) {
        buttons.push(`<button class="${i === page ? btnActive : btnNormal}" ${i === page ? '' : `onclick="goToPage(${i})"`}>${i}</button>`);
    }

    if (end < totalPages) {
        if (end < totalPages - 1) buttons.push(`<span class="text-txt-lighter text-xs px-1">...</span>`);
        buttons.push(`<button class="${btnNormal}" onclick="goToPage(${totalPages})">${totalPages}</button>`);
    }

    buttons.push(`<button class="${page === totalPages ? btnDisabled : btnNormal}" ${page === totalPages ? 'disabled' : `onclick="goToPage(${page + 1})"`}>&rsaquo;</button>`);

    container.innerHTML = `
        <div class="flex items-center justify-center gap-1.5 mt-4 mb-2">
            ${buttons.join('')}
        </div>
        <p class="text-center text-xs text-txt-lighter">${totalCount}개 중 ${(page-1)*20+1}-${Math.min(page*20, totalCount)}번째</p>
    `;
}

// Like
async function toggleLike(questionId, btn) {
    if (isAdminMode || isTeacherMode) return;
    try {
        const data = await api(`/api/questions/${questionId}/like`, { method: 'POST' });
        const heart = btn.querySelector('.heart');
        const count = btn.querySelector('.like-count');

        if (data.liked) {
            btn.className = 'like-btn inline-flex items-center gap-1.5 px-4 py-1.5 border-2 rounded-full text-sm font-semibold cursor-pointer transition-all border-pastel-coral text-pastel-coral bg-red-50';
            heart.textContent = '\u2665';
            heart.className = 'heart text-base transition-transform text-pastel-coral animate-heartPop';
        } else {
            btn.className = 'like-btn inline-flex items-center gap-1.5 px-4 py-1.5 border-2 rounded-full text-sm font-semibold cursor-pointer transition-all border-[#FFD0A0] text-txt-light bg-white hover:border-pastel-coral hover:text-pastel-coral hover:bg-red-50';
            heart.textContent = '\u2665';
            heart.className = 'heart text-base transition-transform text-txt-lighter';
        }
        count.textContent = data.like_count;
    } catch (err) {
        showToast(err.message, 'error');
    }
}

// Sort
function setupSortButtons() {
    document.querySelectorAll('.sort-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.sort-btn').forEach(b => {
                b.classList.remove('active', 'bg-gradient-to-r', 'from-pastel-orange', 'to-pastel-coral', '!text-white', '!border-transparent');
                b.classList.add('bg-white', 'text-txt-light');
            });
            btn.classList.add('active', 'bg-gradient-to-r', 'from-pastel-orange', 'to-pastel-coral', '!text-white', '!border-transparent');
            btn.classList.remove('bg-white', 'text-txt-light');
            currentSort = btn.dataset.sort;
            currentPage = 1;
            loadQuestions();
        });
    });

    const activeBtn = document.querySelector('.sort-btn.active');
    if (activeBtn) {
        activeBtn.classList.add('bg-gradient-to-r', 'from-pastel-orange', 'to-pastel-coral', '!text-white', '!border-transparent');
        activeBtn.classList.remove('bg-white', 'text-txt-light');
    }
}

// Date Navigation
function setupDateNavigation() {
    document.getElementById('prev-date').addEventListener('click', () => {
        currentDate = addDays(currentDate, -1);
        currentPage = 1;
        updateDateDisplay();
        loadQuestions();
    });

    document.getElementById('next-date').addEventListener('click', () => {
        const today = getLocalToday();
        if (currentDate >= today) return;
        currentDate = addDays(currentDate, 1);
        currentPage = 1;
        updateDateDisplay();
        loadQuestions();
    });
}

function updateDateDisplay() {
    const today = getLocalToday();
    const dateText = document.getElementById('current-date-text');
    const nextBtn = document.getElementById('next-date');

    if (currentDate === today) {
        dateText.textContent = `${formatDate(currentDate)} - 오늘`;
    } else {
        dateText.textContent = formatDate(currentDate);
    }

    nextBtn.disabled = currentDate >= today;
}

// Past Dates
function setupPastDates() {
    document.getElementById('toggle-dates').addEventListener('click', async () => {
        const list = document.getElementById('dates-list');
        if (list.style.display === 'none') {
            try {
                const data = await api('/api/dates');
                list.innerHTML = data.dates.map(d => `
                    <div class="flex items-center justify-between px-4 py-3 bg-white rounded-xl shadow-sm cursor-pointer transition-all border border-[#FFE8CC]/20 hover:bg-cream-dark hover:translate-x-1" onclick="goToDate('${d.date}')">
                        <span class="text-sm font-semibold">${formatDate(d.date)}</span>
                        <span class="text-xs bg-cream-dark text-[#C45E00] px-2.5 py-0.5 rounded-full font-bold">${d.count}개</span>
                    </div>
                `).join('') || '<p class="text-center text-txt-lighter py-5 text-sm">아직 질문이 없습니다</p>';
                list.style.display = 'flex';
                document.getElementById('toggle-dates').textContent = '접기';
            } catch (err) {
                showToast(err.message, 'error');
            }
        } else {
            list.style.display = 'none';
            document.getElementById('toggle-dates').textContent = '지난 질문 보기';
        }
    });
}

function goToDate(dateStr) {
    currentDate = dateStr;
    currentPage = 1;
    updateDateDisplay();
    loadQuestions();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Edit / Delete
function startEditQuestion(questionId, btn) {
    const contentEl = document.querySelector(`.question-content-${questionId}`);
    const originalText = contentEl.textContent.trim();

    contentEl.innerHTML = `
        <textarea id="edit-textarea-${questionId}" class="w-full p-3 border-2 border-pastel-orange rounded-xl text-base font-body resize-none bg-white focus:outline-none focus:ring-2 focus:ring-pastel-orange/20 transition" rows="3" maxlength="200">${escapeHtml(originalText)}</textarea>
        <div class="flex items-center justify-between mt-2">
            <span class="edit-char-count text-xs text-txt-lighter">${originalText.length}/200</span>
            <div class="flex gap-1.5">
                <button class="px-3.5 py-1.5 rounded-lg text-xs font-bold border border-[#E0D0C0] text-txt-light bg-white hover:bg-cream-dark transition" onclick="cancelEdit(${questionId}, '${escapeHtml(originalText).replace(/'/g, "\\'")}'")>취소</button>
                <button class="px-3.5 py-1.5 rounded-lg text-xs font-bold bg-gradient-to-r from-pastel-orange to-pastel-coral text-white hover:opacity-90 transition" onclick="saveEditQuestion(${questionId})">저장</button>
            </div>
        </div>
    `;

    const textarea = document.getElementById(`edit-textarea-${questionId}`);
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    textarea.addEventListener('input', () => {
        contentEl.querySelector('.edit-char-count').textContent = `${textarea.value.length}/200`;
    });
}

function cancelEdit(questionId, originalText) {
    const contentEl = document.querySelector(`.question-content-${questionId}`);
    contentEl.textContent = originalText;
}

async function saveEditQuestion(questionId) {
    const textarea = document.getElementById(`edit-textarea-${questionId}`);
    const content = textarea.value.trim();

    if (!content) {
        showToast('질문을 입력해주세요', 'error');
        return;
    }

    try {
        const data = await api(`/api/questions/${questionId}`, {
            method: 'PUT',
            body: JSON.stringify({ content }),
        });
        showToast(data.message);
        loadQuestions();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function deleteMyQuestion(questionId) {
    if (!confirm('정말 이 질문을 삭제하시겠습니까?\n삭제된 내용은 복구할 수 없습니다.')) return;

    try {
        const data = await api(`/api/questions/${questionId}`, {
            method: 'DELETE',
        });
        showToast(data.message);
        loadQuestions();
    } catch (err) {
        showToast(err.message, 'error');
    }
}
