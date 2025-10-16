const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const xlsx = require('xlsx');
const cron = require('node-cron');

const app = express();
const PORT = process.env.PORT || 3000;

// 데이터베이스 초기화
const db = new sqlite3.Database('./security_checker.db', (err) => {
  if (err) {
    console.error('데이터베이스 연결 오류:', err.message);
  } else {
    console.log('SQLite 데이터베이스에 연결되었습니다.');
    initDatabase();
  }
});

// 데이터베이스 테이블 생성
function initDatabase() {
  db.serialize(() => {
    // 구성원 테이블
    db.run(`CREATE TABLE IF NOT EXISTS employees (
      employee_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      job_type TEXT,
      division TEXT,
      center_team TEXT,
      group_name TEXT,
      department TEXT
    )`);

    // 관리자 테이블
    db.run(`CREATE TABLE IF NOT EXISTS admins (
      employee_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      password TEXT DEFAULT '1234',
      job_type TEXT,
      division TEXT,
      center_team TEXT,
      group_name TEXT,
      department TEXT
    )`);

    // 보안 체크 기록 테이블
    db.run(`CREATE TABLE IF NOT EXISTS check_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id TEXT NOT NULL,
      check_date TEXT NOT NULL,
      check_time TEXT NOT NULL,
      pc_shutdown INTEGER DEFAULT 0,
      lock_check INTEGER DEFAULT 0,
      document_security INTEGER DEFAULT 0,
      completed INTEGER DEFAULT 0,
      FOREIGN KEY (employee_id) REFERENCES employees(employee_id),
      UNIQUE(employee_id, check_date)
    )`);

    console.log('데이터베이스 테이블이 생성되었습니다.');
    
    // 슈퍼 관리자 계정 생성 (존재하지 않을 경우에만)
    db.get('SELECT * FROM admins WHERE employee_id = ?', ['admin'], (err, row) => {
      if (err) {
        console.error('관리자 확인 오류:', err);
      } else if (!row) {
        db.run(
          `INSERT INTO admins (employee_id, name, password, job_type, division, center_team, group_name, department)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          ['admin', '슈퍼관리자', 'asdf1234', '시스템관리', '전체', '전체', '전체', '전체'],
          (err) => {
            if (err) {
              console.error('슈퍼 관리자 생성 오류:', err);
            } else {
              console.log('✅ 슈퍼 관리자 계정이 생성되었습니다.');
              console.log('   ID: admin');
              console.log('   PW: asdf1234');
            }
          }
        );
      } else {
        console.log('✅ 슈퍼 관리자 계정이 이미 존재합니다.');
      }
    });
  });
}

// 미들웨어 설정
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(session({
  secret: 'security-checker-secret-key-2025',
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: false,
    maxAge: 24 * 60 * 60 * 1000 // 24시간
  }
}));

// 파일 업로드 설정
const upload = multer({ dest: 'uploads/' });

// 매일 자정 체크 초기화 (매일 00:00)
cron.schedule('0 0 * * *', () => {
  console.log('일일 보안 체크 초기화 실행');
  // 체크 기록은 유지하되, 새로운 날짜에는 다시 체크할 수 있도록 함
});

// 라우트
// 메인 페이지
app.get('/', (req, res) => {
  res.render('index');
});

// 구성원 로그인 페이지
app.get('/employee/login', (req, res) => {
  res.render('employee/login');
});

// 구성원 로그인 처리
app.post('/employee/login', (req, res) => {
  const { employee_id } = req.body;
  
  db.get('SELECT * FROM employees WHERE employee_id = ?', [employee_id], (err, row) => {
    if (err) {
      return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
    }
    if (!row) {
      return res.status(401).json({ success: false, message: '등록되지 않은 사번입니다.' });
    }
    
    req.session.user = {
      employee_id: row.employee_id,
      name: row.name,
      type: 'employee'
    };
    
    res.json({ success: true, redirect: '/employee/dashboard' });
  });
});

// 구성원 대시보드
app.get('/employee/dashboard', (req, res) => {
  if (!req.session.user || req.session.user.type !== 'employee') {
    return res.redirect('/employee/login');
  }
  
  const employee_id = req.session.user.employee_id;
  // 한국 시간(KST) 기준
  const nowKST = new Date(new Date().getTime() + (9 * 60 * 60 * 1000));
  const today = nowKST.toISOString().split('T')[0];
  
  // 오늘 체크 기록 조회
  db.get(
    'SELECT * FROM check_records WHERE employee_id = ? AND check_date = ?',
    [employee_id, today],
    (err, todayRecord) => {
      if (err) {
        console.error(err);
        return res.status(500).send('서버 오류가 발생했습니다.');
      }
      
      // 전체 체크 횟수 조회
      db.get(
        'SELECT COUNT(*) as total FROM check_records WHERE employee_id = ? AND completed = 1',
        [employee_id],
        (err, countResult) => {
          if (err) {
            console.error(err);
            return res.status(500).send('서버 오류가 발생했습니다.');
          }
          
          res.render('employee/dashboard', {
            user: req.session.user,
            todayRecord: todayRecord,
            totalChecks: countResult.total
          });
        }
      );
    }
  );
});

// 보안 체크 저장
app.post('/employee/save-check', (req, res) => {
  if (!req.session.user || req.session.user.type !== 'employee') {
    return res.status(401).json({ success: false, message: '로그인이 필요합니다.' });
  }
  
  const employee_id = req.session.user.employee_id;
  
  // 한국 시간(KST) 기준으로 날짜와 시간 생성
  const nowKST = new Date(new Date().getTime() + (9 * 60 * 60 * 1000)); // UTC + 9시간
  const today = nowKST.toISOString().split('T')[0];
  
  // 년월일시분 형식으로 저장 (202510161415)
  const checkDateTime = 
    nowKST.getUTCFullYear() + 
    String(nowKST.getUTCMonth() + 1).padStart(2, '0') + 
    String(nowKST.getUTCDate()).padStart(2, '0') + 
    String(nowKST.getUTCHours()).padStart(2, '0') + 
    String(nowKST.getUTCMinutes()).padStart(2, '0');
  
  const { pc_shutdown, lock_check, document_security } = req.body;
  
  // 모든 항목이 체크되었는지 확인
  if (!pc_shutdown || !lock_check || !document_security) {
    return res.status(400).json({ success: false, message: '모든 항목을 체크해주세요.' });
  }
  
  // 오늘 이미 체크했는지 확인
  db.get(
    'SELECT * FROM check_records WHERE employee_id = ? AND check_date = ?',
    [employee_id, today],
    (err, row) => {
      if (err) {
        return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
      }
      
      if (row) {
        return res.status(400).json({ success: false, message: '오늘은 이미 체크를 완료했습니다.' });
      }
      
      // 체크 기록 저장
      db.run(
        `INSERT INTO check_records (employee_id, check_date, check_time, pc_shutdown, lock_check, document_security, completed)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [employee_id, today, checkDateTime, 1, 1, 1, 1],
        (err) => {
          if (err) {
            return res.status(500).json({ success: false, message: '저장 중 오류가 발생했습니다.' });
          }
          
          res.json({ success: true, message: '보안 체크가 완료되었습니다!' });
        }
      );
    }
  );
});

// 관리자 로그인 페이지
app.get('/admin/login', (req, res) => {
  res.render('admin/login');
});

// 관리자 로그인 처리
app.post('/admin/login', (req, res) => {
  const { employee_id, password } = req.body;
  
  db.get(
    'SELECT * FROM admins WHERE employee_id = ? AND password = ?',
    [employee_id, password],
    (err, row) => {
      if (err) {
        return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
      }
      if (!row) {
        return res.status(401).json({ success: false, message: '사번 또는 비밀번호가 올바르지 않습니다.' });
      }
      
      req.session.user = {
        employee_id: row.employee_id,
        name: row.name,
        division: row.division,
        center_team: row.center_team,
        group_name: row.group_name,
        department: row.department,
        type: 'admin'
      };
      
      res.json({ success: true, redirect: '/admin/dashboard' });
    }
  );
});

// 관리자 대시보드
app.get('/admin/dashboard', (req, res) => {
  if (!req.session.user || req.session.user.type !== 'admin') {
    return res.redirect('/admin/login');
  }
  
  const admin = req.session.user;
  // 한국 시간(KST) 기준
  const nowKST = new Date(new Date().getTime() + (9 * 60 * 60 * 1000));
  const today = nowKST.toISOString().split('T')[0];
  const selectedDate = req.query.date || today; // 쿼리 파라미터로 날짜 받기
  
  // 같은 소속의 구성원 조회 (센터/팀 기준)
  let query = `
    SELECT e.*, 
           CASE WHEN cr.completed = 1 THEN '완료' ELSE '미완료' END as today_status,
           cr.check_time as check_time,
           (SELECT COUNT(*) FROM check_records WHERE employee_id = e.employee_id AND completed = 1) as total_checks
    FROM employees e
    LEFT JOIN check_records cr ON e.employee_id = cr.employee_id AND cr.check_date = ?
    WHERE 1=1
  `;
  
  const params = [selectedDate];
  
  // 슈퍼 관리자(admin)가 아닌 경우에만 소속 필터링
  if (admin.employee_id !== 'admin') {
    if (admin.division && admin.division !== '전체') {
      query += ' AND e.division = ?';
      params.push(admin.division);
    }
    if (admin.center_team && admin.center_team !== '전체') {
      query += ' AND e.center_team = ?';
      params.push(admin.center_team);
    }
  }
  
  query += ' ORDER BY e.employee_id';
  
  db.all(query, params, (err, rows) => {
    if (err) {
      console.error(err);
      return res.status(500).send('서버 오류가 발생했습니다.');
    }
    
    res.render('admin/dashboard', {
      user: admin,
      employees: rows,
      today: today,
      selectedDate: selectedDate
    });
  });
});

// 관리자 - 엑셀 다운로드 (누적 데이터)
app.get('/admin/download-excel', (req, res) => {
  if (!req.session.user || req.session.user.type !== 'admin') {
    return res.status(401).send('권한이 없습니다.');
  }
  
  const admin = req.session.user;
  const today = new Date().toISOString().split('T')[0];
  
  // 누적 데이터 조회 쿼리
  let query = `
    SELECT e.employee_id as '사번', 
           e.name as '이름',
           e.job_type as '직군',
           e.division as '본부',
           e.center_team as '센터/팀',
           e.group_name as '그룹',
           e.department as '실',
           cr.check_date as '체크일자',
           cr.check_time as '체크시간',
           CASE WHEN cr.completed = 1 THEN '완료' ELSE '미완료' END as '완료여부'
    FROM employees e
    LEFT JOIN check_records cr ON e.employee_id = cr.employee_id
    WHERE 1=1
  `;
  
  const params = [];
  
  // 슈퍼 관리자(admin)가 아닌 경우에만 소속 필터링
  if (admin.employee_id !== 'admin') {
    if (admin.division && admin.division !== '전체') {
      query += ' AND e.division = ?';
      params.push(admin.division);
    }
    if (admin.center_team && admin.center_team !== '전체') {
      query += ' AND e.center_team = ?';
      params.push(admin.center_team);
    }
  }
  
  query += ' ORDER BY e.employee_id, cr.check_date DESC';
  
  db.all(query, params, (err, rows) => {
    if (err) {
      console.error(err);
      return res.status(500).send('서버 오류가 발생했습니다.');
    }
    
    const worksheet = xlsx.utils.json_to_sheet(rows);
    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook, worksheet, '보안체크누적데이터');
    
    const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    
    // 한국 시간(KST) 기준 타임스탬프
    const nowKST = new Date(new Date().getTime() + (9 * 60 * 60 * 1000));
    const timestamp = 
      nowKST.getUTCFullYear() + 
      String(nowKST.getUTCMonth() + 1).padStart(2, '0') + 
      String(nowKST.getUTCDate()).padStart(2, '0') + 
      String(nowKST.getUTCHours()).padStart(2, '0') + 
      String(nowKST.getUTCMinutes()).padStart(2, '0');
    
    res.setHeader('Content-Disposition', `attachment; filename=security_check_all_${timestamp}.xlsx`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
  });
});

// 구성원 정보 업로드
app.post('/admin/upload-employees', upload.single('file'), (req, res) => {
  if (!req.session.user || req.session.user.type !== 'admin') {
    return res.status(401).json({ success: false, message: '권한이 없습니다.' });
  }
  
  if (!req.file) {
    return res.status(400).json({ success: false, message: '파일을 선택해주세요.' });
  }
  
  try {
    const workbook = xlsx.readFile(req.file.path);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const data = xlsx.utils.sheet_to_json(sheet);
    
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO employees (employee_id, name, job_type, division, center_team, group_name, department)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    
    data.forEach((row) => {
      stmt.run(
        row['사번'] || row['employee_id'],
        row['이름'] || row['name'],
        row['직군'] || row['job_type'],
        row['본부'] || row['division'],
        row['센터/팀'] || row['center_team'],
        row['그룹'] || row['group_name'],
        row['실'] || row['department']
      );
    });
    
    stmt.finalize();
    
    res.json({ success: true, message: `${data.length}명의 구성원 정보가 업로드되었습니다.` });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: '파일 처리 중 오류가 발생했습니다.' });
  }
});

// 관리자 정보 업로드
app.post('/admin/upload-admins', upload.single('file'), (req, res) => {
  if (!req.session.user || req.session.user.type !== 'admin') {
    return res.status(401).json({ success: false, message: '권한이 없습니다.' });
  }
  
  if (!req.file) {
    return res.status(400).json({ success: false, message: '파일을 선택해주세요.' });
  }
  
  try {
    const workbook = xlsx.readFile(req.file.path);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const data = xlsx.utils.sheet_to_json(sheet);
    
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO admins (employee_id, name, password, job_type, division, center_team, group_name, department)
      VALUES (?, ?, '1234', ?, ?, ?, ?, ?)
    `);
    
    data.forEach((row) => {
      stmt.run(
        row['사번'] || row['employee_id'],
        row['이름'] || row['name'],
        row['직군'] || row['job_type'],
        row['본부'] || row['division'],
        row['센터/팀'] || row['center_team'],
        row['그룹'] || row['group_name'],
        row['실'] || row['department']
      );
    });
    
    stmt.finalize();
    
    res.json({ success: true, message: `${data.length}명의 관리자 정보가 업로드되었습니다.` });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: '파일 처리 중 오류가 발생했습니다.' });
  }
});

// 로그아웃
app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

// 서버 시작
app.listen(PORT, '0.0.0.0', () => {
  console.log(`서버가 포트 ${PORT}에서 실행 중입니다.`);
  console.log(`구성원 페이지: http://localhost:${PORT}/employee/login`);
  console.log(`관리자 페이지: http://localhost:${PORT}/admin/login`);
});
