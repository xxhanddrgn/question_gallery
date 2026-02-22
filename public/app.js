(function () {
  'use strict';

  // --- State ---
  let currentUser = null; // { id, name }
  let currentDate = null; // null = today, or 'YYYY-MM-DD'
  let availableDates = [];
  let myLikes = new Set();

  // --- DOM refs ---
  const $ = (sel) => document.querySelector(sel);
  const loginPanel = $('#loginPanel');
  const mainContent = $('#mainContent');
  const inputStudentId = $('#inputStudentId');
  const inputStudentName = $('#inputStudentName');
  const btnLogin = $('#btnLogin');
  const btnLogout = $('#btnLogout');
  const userBadge = $('#userBadge');
  const questionFormCard = $('#questionFormCard');
  const alreadySubmitted = $('#alreadySubmitted');
  const questionInput = $('#questionInput');
  const charCount = $('#charCount');
  const btnSubmit = $('#btnSubmit');
  const questionsList = $('#questionsList');
  const emptyState = $('#emptyState');
  const todayCount = $('#todayCount');
  const dateText = $('#dateText');
  const btnPrevDate = $('#btnPrevDate');
  const btnNextDate = $('#btnNextDate');
  const btnToday = $('#btnToday');
  const toast = $('#toast');
  const toastMsg = $('#toastMsg');

  // --- Utility ---
  function showToast(msg, duration) {
    duration = duration || 2500;
    toastMsg.textContent = msg;
    toast.classList.remove('hidden');
    toast.classList.add('show');
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.classList.add('hidden'), 300);
    }, duration);
  }

  function formatDate(dateStr) {
    var d = new Date(dateStr + 'T00:00:00');
    var month = d.getMonth() + 1;
    var day = d.getDate();
    var weekdays = ['일', '월', '화', '수', '목', '금', '토'];
    var weekday = weekdays[d.getDay()];
    return month + '월 ' + day + '일 (' + weekday + ')';
  }

  function formatTime(datetimeStr) {
    var parts = datetimeStr.split(' ');
    if (parts.length < 2) return datetimeStr;
    var timeParts = parts[1].split(':');
    return timeParts[0] + ':' + timeParts[1];
  }

  function getAvatarIndex(name) {
    var sum = 0;
    for (var i = 0; i < name.length; i++) {
      sum += name.charCodeAt(i);
    }
    return sum % 10;
  }

  function getTodayStr() {
    var now = new Date();
    var year = now.getFullYear();
    var month = String(now.getMonth() + 1).padStart(2, '0');
    var day = String(now.getDate()).padStart(2, '0');
    return year + '-' + month + '-' + day;
  }

  function isToday(dateStr) {
    return !dateStr || dateStr === getTodayStr();
  }

  // --- API ---
  function api(method, url, body) {
    var opts = {
      method: method,
      headers: { 'Content-Type': 'application/json' }
    };
    if (body) opts.body = JSON.stringify(body);
    return fetch(url, opts).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok) {
          throw new Error(data.error || '오류가 발생했습니다.');
        }
        return data;
      });
    });
  }

  // --- Session ---
  function saveSession() {
    if (currentUser) {
      localStorage.setItem('questionChallenge_user', JSON.stringify(currentUser));
    }
  }

  function loadSession() {
    try {
      var saved = localStorage.getItem('questionChallenge_user');
      if (saved) {
        currentUser = JSON.parse(saved);
        return true;
      }
    } catch (e) { /* ignore */ }
    return false;
  }

  function clearSession() {
    currentUser = null;
    localStorage.removeItem('questionChallenge_user');
  }

  // --- Login / Logout ---
  function showLogin() {
    loginPanel.classList.remove('hidden');
    mainContent.classList.add('hidden');
  }

  function showMain() {
    loginPanel.classList.add('hidden');
    mainContent.classList.remove('hidden');
    userBadge.textContent = currentUser.id + ' ' + currentUser.name;
    loadQuestions();
    loadDates();
  }

  function doLogin() {
    var id = inputStudentId.value.trim();
    var name = inputStudentName.value.trim();

    if (!id) {
      showToast('반번호를 입력해주세요.');
      inputStudentId.focus();
      return;
    }
    if (!name) {
      showToast('이름을 입력해주세요.');
      inputStudentName.focus();
      return;
    }

    currentUser = { id: id, name: name };
    saveSession();
    showMain();
  }

  function doLogout() {
    clearSession();
    inputStudentId.value = '';
    inputStudentName.value = '';
    currentDate = null;
    showLogin();
  }

  // --- Load Questions ---
  function loadQuestions() {
    var url = isToday(currentDate)
      ? '/api/questions/today'
      : '/api/questions/' + currentDate;

    // Show skeleton
    questionsList.innerHTML = '';
    for (var i = 0; i < 3; i++) {
      var skel = document.createElement('div');
      skel.className = 'skeleton skeleton-card';
      questionsList.appendChild(skel);
    }
    emptyState.classList.add('hidden');

    api('GET', url).then(function (data) {
      var questions = data.questions;
      if (data.total !== undefined) {
        todayCount.textContent = data.total;
      }

      // Load likes
      var likeUrl = currentUser
        ? (isToday(currentDate)
          ? '/api/likes/' + encodeURIComponent(currentUser.id) + '/today'
          : '/api/likes/' + encodeURIComponent(currentUser.id) + '/' + currentDate)
        : null;

      var likePromise = likeUrl
        ? api('GET', likeUrl)
        : Promise.resolve({ likes: [] });

      return likePromise.then(function (likeData) {
        myLikes = new Set(likeData.likes);
        renderQuestions(questions);
        updateFormState(questions);
      });
    }).catch(function (err) {
      questionsList.innerHTML = '';
      showToast('질문을 불러오는데 실패했습니다.');
      console.error(err);
    });
  }

  function renderQuestions(questions) {
    questionsList.innerHTML = '';

    if (questions.length === 0) {
      emptyState.classList.remove('hidden');
      return;
    }

    emptyState.classList.add('hidden');

    questions.forEach(function (q, idx) {
      var card = document.createElement('div');
      card.className = 'question-card';
      card.style.animationDelay = (idx * 0.05) + 's';

      var avatarIdx = getAvatarIndex(q.student_name);
      var initial = q.student_name.charAt(0);
      var liked = myLikes.has(q.id);

      card.innerHTML =
        '<div class="question-card-header">' +
          '<div class="question-author">' +
            '<div class="author-avatar avatar-' + avatarIdx + '">' + initial + '</div>' +
            '<div class="author-info">' +
              '<div class="author-name">' + escapeHtml(q.student_name) + '</div>' +
              '<div class="author-id">' + escapeHtml(q.student_id) + '</div>' +
            '</div>' +
          '</div>' +
          '<span class="question-time">' + formatTime(q.created_at) + '</span>' +
        '</div>' +
        '<div class="question-content">' + escapeHtml(q.content) + '</div>' +
        '<div class="question-card-footer">' +
          '<button class="like-btn' + (liked ? ' liked' : '') + '" data-id="' + q.id + '">' +
            '<svg class="heart-icon" width="16" height="16" viewBox="0 0 24 24" fill="' + (liked ? 'currentColor' : 'none') + '" stroke="currentColor" stroke-width="2">' +
              '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>' +
            '</svg>' +
            '<span class="like-count">' + (q.like_count > 0 ? q.like_count : '') + '</span>' +
          '</button>' +
        '</div>';

      questionsList.appendChild(card);
    });
  }

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
  }

  function updateFormState(questions) {
    if (!isToday(currentDate)) {
      questionFormCard.classList.add('hidden');
      alreadySubmitted.classList.add('hidden');
      return;
    }

    var hasPosted = questions.some(function (q) {
      return q.student_id === currentUser.id;
    });

    if (hasPosted) {
      questionFormCard.classList.add('hidden');
      alreadySubmitted.classList.remove('hidden');
    } else {
      questionFormCard.classList.remove('hidden');
      alreadySubmitted.classList.add('hidden');
      questionInput.value = '';
      charCount.textContent = '0';
    }
  }

  // --- Submit Question ---
  function submitQuestion() {
    var content = questionInput.value.trim();
    if (!content) {
      showToast('질문 내용을 입력해주세요.');
      questionInput.focus();
      return;
    }

    btnSubmit.disabled = true;

    api('POST', '/api/questions', {
      studentId: currentUser.id,
      studentName: currentUser.name,
      content: content
    }).then(function () {
      showToast('질문이 등록되었어요!');
      questionInput.value = '';
      charCount.textContent = '0';
      currentDate = null;
      updateDateDisplay();
      loadQuestions();
    }).catch(function (err) {
      showToast(err.message);
    }).finally(function () {
      btnSubmit.disabled = false;
    });
  }

  // --- Like ---
  function toggleLike(questionId, btn) {
    if (!currentUser) return;

    api('POST', '/api/questions/' + questionId + '/like', {
      studentId: currentUser.id
    }).then(function (data) {
      var countEl = btn.querySelector('.like-count');
      var heartEl = btn.querySelector('.heart-icon');

      if (data.liked) {
        myLikes.add(questionId);
        btn.classList.add('liked');
        heartEl.setAttribute('fill', 'currentColor');
      } else {
        myLikes.delete(questionId);
        btn.classList.remove('liked');
        heartEl.setAttribute('fill', 'none');
      }

      // Reload to get fresh count
      loadQuestions();
    }).catch(function (err) {
      showToast(err.message);
    });
  }

  // --- Date Navigation ---
  function loadDates() {
    api('GET', '/api/dates').then(function (data) {
      availableDates = data.dates.map(function (d) { return d.date_key; });
      updateDateNav();
    });
  }

  function updateDateDisplay() {
    if (isToday(currentDate)) {
      dateText.textContent = '오늘 (' + formatDate(getTodayStr()) + ')';
    } else {
      dateText.textContent = formatDate(currentDate);
    }
  }

  function updateDateNav() {
    updateDateDisplay();

    var todayStr = getTodayStr();
    var allDates = availableDates.slice();
    if (allDates.indexOf(todayStr) === -1) {
      allDates.unshift(todayStr);
    }
    allDates.sort().reverse();

    var currentKey = currentDate || todayStr;
    var currentIdx = allDates.indexOf(currentKey);

    btnNextDate.disabled = (currentIdx <= 0);
    btnPrevDate.disabled = (currentIdx >= allDates.length - 1);
    btnToday.classList.toggle('hidden', isToday(currentDate));
  }

  function navigate(direction) {
    var todayStr = getTodayStr();
    var allDates = availableDates.slice();
    if (allDates.indexOf(todayStr) === -1) {
      allDates.unshift(todayStr);
    }
    allDates.sort().reverse();

    var currentKey = currentDate || todayStr;
    var currentIdx = allDates.indexOf(currentKey);
    var newIdx = currentIdx + direction;

    if (newIdx >= 0 && newIdx < allDates.length) {
      var newDate = allDates[newIdx];
      currentDate = (newDate === todayStr) ? null : newDate;
      updateDateNav();
      loadQuestions();
    }
  }

  // --- Event Listeners ---
  btnLogin.addEventListener('click', doLogin);
  inputStudentName.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') doLogin();
  });
  inputStudentId.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') inputStudentName.focus();
  });

  btnLogout.addEventListener('click', doLogout);

  questionInput.addEventListener('input', function () {
    charCount.textContent = questionInput.value.length;
  });

  btnSubmit.addEventListener('click', submitQuestion);

  questionsList.addEventListener('click', function (e) {
    var btn = e.target.closest('.like-btn');
    if (btn) {
      var id = parseInt(btn.getAttribute('data-id'), 10);
      toggleLike(id, btn);
    }
  });

  btnPrevDate.addEventListener('click', function () { navigate(1); });
  btnNextDate.addEventListener('click', function () { navigate(-1); });
  btnToday.addEventListener('click', function () {
    currentDate = null;
    updateDateNav();
    loadQuestions();
  });

  // --- Init ---
  if (loadSession()) {
    showMain();
  } else {
    showLogin();
  }
})();
