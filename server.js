const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');

app.use(express.json());

// Root serves the checklist directly
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'role', 'index.html'));
});

// Static files
app.use(express.static(path.join(__dirname, 'public')));
app.use('/role', express.static(path.join(__dirname, 'public', 'role')));

// Initialize data file
function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('Error loading data:', e);
  }
  return getDefaultData();
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function getDefaultData() {
  return {
    className: "6학년 1반",
    motto: "우리 모두 지켜요",
    roles: [
      { id: 1, role: "선생님 비서", students: ["정하윤"], days: [1,2,3,4,5] },
      { id: 2, role: "분리수거", students: ["김윤중", "신승운", "신재윤"], days: [5] },
      { id: 3, role: "교실 쓸기, 닦기", students: ["김윤슬", "정민찬"], days: [1,3,5] },
      { id: 4, role: "우유 관리사", students: ["신주환", "최예준"], days: [1,2,3,4,5] },
      { id: 5, role: "소방관", students: ["한소율"], days: [1,2,3,4,5] },
      { id: 6, role: "옷걸이 정리, 크롬북 정리", students: ["이초연"], days: [1,2,3,4,5] },
      { id: 7, role: "복도 쓸기, 닦기", students: ["정태준", "임아현"], days: [1,3,5] },
      { id: 8, role: "출입문 지킴이", students: ["권재우"], days: [1,2,3,4,5] },
      { id: 9, role: "우체부", students: ["김예빈"], days: [1,2,3,4,5] },
      { id: 10, role: "교실 환기", students: ["오하라"], days: [1,2,3,4,5] }
    ],
    checks: {}
  };
}

// API: Get roles
app.get('/api/roles', (req, res) => {
  const data = loadData();
  res.json({
    className: data.className,
    motto: data.motto,
    roles: data.roles
  });
});

// API: Update roles (admin)
app.post('/api/roles', (req, res) => {
  const data = loadData();
  const { className, motto, roles } = req.body;
  if (className) data.className = className;
  if (motto) data.motto = motto;
  if (roles) data.roles = roles;
  saveData(data);
  res.json({ success: true });
});

// API: Get checks for a date
app.get('/api/checks/:date', (req, res) => {
  const data = loadData();
  const dateChecks = data.checks[req.params.date] || {};
  res.json(dateChecks);
});

// API: Student submits a check
app.post('/api/checks', (req, res) => {
  const data = loadData();
  const { date, roleId, student, checked } = req.body;
  if (!data.checks[date]) data.checks[date] = {};
  const key = `${roleId}_${student}`;
  if (checked) {
    data.checks[date][key] = {
      checked: true,
      time: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
    };
  } else {
    delete data.checks[date][key];
  }
  saveData(data);
  res.json({ success: true });
});

// API: Teacher approves/rejects a check
app.post('/api/approve', (req, res) => {
  const data = loadData();
  const { date, roleId, student, approved } = req.body;
  if (!data.checks[date]) data.checks[date] = {};
  const key = `${roleId}_${student}`;
  if (data.checks[date][key]) {
    data.checks[date][key].approved = approved;
    data.checks[date][key].approveTime = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  }
  saveData(data);
  res.json({ success: true });
});

// API: Reset checks for a date
app.delete('/api/checks/:date', (req, res) => {
  const data = loadData();
  delete data.checks[req.params.date];
  saveData(data);
  res.json({ success: true });
});

// API: Get all check dates (for history)
app.get('/api/history', (req, res) => {
  const data = loadData();
  const dates = Object.keys(data.checks).sort().reverse();
  res.json(dates);
});

// API: Get checks summary for date range
app.get('/api/summary', (req, res) => {
  const data = loadData();
  const { from, to } = req.query;
  const summary = {};

  data.roles.forEach(role => {
    role.students.forEach(student => {
      const key = `${role.id}_${student}`;
      summary[key] = { role: role.role, student, total: 0, approved: 0 };
    });
  });

  Object.keys(data.checks).forEach(date => {
    if (from && date < from) return;
    if (to && date > to) return;
    Object.keys(data.checks[date]).forEach(key => {
      if (summary[key]) {
        if (data.checks[date][key].checked) summary[key].total++;
        if (data.checks[date][key].approved) summary[key].approved++;
      }
    });
  });

  res.json(Object.values(summary));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  // Initialize data file if needed
  if (!fs.existsSync(DATA_FILE)) {
    saveData(getDefaultData());
  }
});
