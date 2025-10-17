const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');
const { Pool } = require('pg');
const multer = require('multer');
const xlsx = require('xlsx');
const cron = require('node-cron');

// 서비스에이스 보안점검 시스템
const app = express();
const PORT = process.env.PORT || 3000;

// PostgreSQL 연결 설정
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
  max: 20, // 최대 연결 수
  idleTimeoutMillis: 30000, // 유휴 연결 타임아웃
  connectionTimeoutMillis: 10000, // 연결 타임아웃
});

// 데이터베이스 연결 확인
pool.connect((err, client, release) => {
  if (err) {
    console.error('❌ 데이터베이스 연결 오류:', err.message);
    console.error('전체 오류:', err);
  } else {
    console.log('✅ PostgreSQL 데이터베이스에 연결되었습니다.');
    release();
    initDatabase();
  }
});

// 데이터베이스 연결 오류 처리
pool.on('error', (err, client) => {
  console.error('❌ 예상치 못한 데이터베이스 오류:', err);
});
// 데이터베이스 테이블 생성
async function initDatabase() {
  try {
    // 구성원 테이블
    await pool.query(`
      CREATE TABLE IF NOT EXISTS employees (
        employee_id VARCHAR(50) PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        job_type VARCHAR(100),
        division VARCHAR(100),
        center_team VARCHAR(100),
        group_name VARCHAR(100),
        department VARCHAR(100)
      )
    `);

    // 관리자 테이블
    await pool.query(`
      CREATE TABLE IF NOT EXISTS admins (
        employee_id VARCHAR(50) PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        password VARCHAR(100) DEFAULT '1234',
        job_type VARCHAR(100),
        division VARCHAR(100),
        center_team VARCHAR(100),
        group_name VARCHAR(100),
        department VARCHAR(100)
      )
    `);

    // 보안 체크 기록 테이블
    await pool.query(`
      CREATE TABLE IF NOT EXISTS check_records (
        id SERIAL PRIMARY KEY,
        employee_id VARCHAR(50) NOT NULL,
        check_date DATE NOT NULL,
        check_time VARCHAR(20) NOT NULL,
        pc_shutdown INTEGER DEFAULT 0,
        lock_check INTEGER DEFAULT 0,
        document_security INTEGER DEFAULT 0,
        completed INTEGER DEFAULT 0,
        UNIQUE(employee_id, check_date)
      )
    `);

    console.log('✅ 데이터베이스 테이블이 생성되었습니다.');
    
    // 슈퍼 관리자 계정 생성 (존재하지 않을 경우에만)
    const adminCheck = await pool.query('SELECT * FROM admins WHERE employee_id = $1', ['admin']);
    
    if (adminCheck.rows.length === 0) {
      await pool.query(
        `INSERT INTO admins (employee_id, name, password, job_type, division, center_team, group_name, department)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        ['admin', '슈퍼관리자', 'asdf1234', '시스템관리', '전체', '전체', '전체', '전체']
      );
      console.log('✅ 슈퍼 관리자 계정이 생성되었습니다.');
      console.log('   ID: admin');
      console.log('   PW: asdf1234');
    } else {
      console.log('✅ 슈퍼 관리자 계정이 이미 존재합니다.');
    }
  } catch (err) {
    console.error('데이터베이스 초기화 오류:', err);
  }
}

// 미들웨어 설정
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(session({
  secret: process.env.SESSION_SECRET || 'security-checker-secret-key-2025',
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: process.env.NODE_ENV === 'production' ? false : false, // HTTPS를 사용하면 true로 변경
    maxAge: 24 * 60 * 60 * 1000, // 24시간
    httpOnly: true
  }
}));

// 파일 업로드 설정
const upload = multer({ dest: 'uploads/' });

// 매일 자정 체크 초기화 (매일 00:00)
cron.schedule('0 0 * * *', () => {
  console.log('일일 보안 체크 초기화 실행');
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
app.post('/employee/login', async (req, res) => {
  const { employee_id } = req.body;
  
  try {
    const result = await pool.query('SELECT * FROM employees WHERE employee_id = $1', [employee_id]);
    
    if (result.rows.length === 0) {
      return res.status(401).json({ success: false, message: '등록되지 않은 사번입니다.' });
    }
    
    const row = result.rows[0];
    req.session.user = {
      employee_id: row.employee_id,
      name: row.name,
      type: 'employee'
    };
    
    res.json({ success: true, redirect: '/employee/dashboard' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
});

// 구성원 대시보드
app.get('/employee/dashboard', async (req, res) => {
  if (!req.session.user || req.session.user.type !== 'employee') {
    return res.redirect('/employee/login');
  }
  
  const employee_id = req.session.user.employee_id;
  // 한국 시간(KST) 기준
  const nowKST = new Date(new Date().getTime() + (9 * 60 * 60 * 1000));
  const today = nowKST.toISOString().split('T')[0];
  
  try {
    // 오늘 체크 기록 조회
    const todayResult = await pool.query(
      'SELECT * FROM check_records WHERE employee_id = $1 AND check_date = $2',
      [employee_id, today]
    );
    
    // 전체 체크 횟수 조회
    const countResult = await pool.query(
      'SELECT COUNT(*) as total FROM check_records WHERE employee_id = $1 AND completed = 1',
      [employee_id]
    );
    
    res.render('employee/dashboard', {
      user: req.session.user,
      todayRecord: todayResult.rows[0] || null,
      totalChecks: parseInt(countResult.rows[0].total)
    });
  } catch (err) {
    console.error(err);
    return res.status(500).send('서버 오류가 발생했습니다.');
  }
});

// 보안 체크 저장
app.post('/employee/save-check', async (req, res) => {
  if (!req.session.user || req.session.user.type !== 'employee') {
    return res.status(401).json({ success: false, message: '로그인이 필요합니다.' });
  }
  
  const employee_id = req.session.user.employee_id;
  
  // 한국 시간(KST) 기준으로 날짜와 시간 생성
  const nowKST = new Date(new Date().getTime() + (9 * 60 * 60 * 1000));
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
  
  try {
    // 오늘 이미 체크했는지 확인
    const checkResult = await pool.query(
      'SELECT * FROM check_records WHERE employee_id = $1 AND check_date = $2',
      [employee_id, today]
    );
    
    if (checkResult.rows.length > 0) {
      return res.status(400).json({ success: false, message: '오늘은 이미 체크를 완료했습니다.' });
    }
    
    // 체크 기록 저장
    await pool.query(
      `INSERT INTO check_records (employee_id, check_date, check_time, pc_shutdown, lock_check, document_security, completed)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [employee_id, today, checkDateTime, 1, 1, 1, 1]
    );
    
    res.json({ success: true, message: '보안 체크가 완료되었습니다!' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: '저장 중 오류가 발생했습니다.' });
  }
});

// 관리자 로그인 페이지
app.get('/admin/login', (req, res) => {
  res.render('admin/login');
});

// 관리자 로그인 처리
app.post('/admin/login', async (req, res) => {
  const { employee_id, password } = req.body;
  
  try {
    const result = await pool.query(
      'SELECT * FROM admins WHERE employee_id = $1 AND password = $2',
      [employee_id, password]
    );
    
    if (result.rows.length === 0) {
      return res.status(401).json({ success: false, message: '사번 또는 비밀번호가 올바르지 않습니다.' });
    }
    
    const row = result.rows[0];
    req.session.user = {
      employee_id: row.employee_id,
      name: row.name,
      job_type: row.job_type,
      division: row.division,
      center_team: row.center_team,
      group_name: row.group_name,
      department: row.department,
      type: 'admin'
    };
    
    res.json({ success: true, redirect: '/admin/dashboard' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
});

// 관리자 대시보드
app.get('/admin/dashboard', async (req, res) => {
  if (!req.session.user || req.session.user.type !== 'admin') {
    return res.redirect('/admin/login');
  }
  
  const admin = req.session.user;
  // 한국 시간(KST) 기준
  const nowKST = new Date(new Date().getTime() + (9 * 60 * 60 * 1000));
  const today = nowKST.toISOString().split('T')[0];
  const selectedDate = req.query.date || today;
  
  try {
    let query = `
      SELECT e.*, 
             CASE WHEN cr.completed = 1 THEN '완료' ELSE '미완료' END as today_status,
             cr.check_time as check_time,
             (SELECT COUNT(*) FROM check_records WHERE employee_id = e.employee_id AND completed = 1) as total_checks
      FROM employees e
      LEFT JOIN check_records cr ON e.employee_id = cr.employee_id AND cr.check_date = $1
      WHERE 1=1
    `;
    
    const params = [selectedDate];
    let paramIndex = 2;
    
    // 슈퍼 관리자(admin), 대표이사, 보안담당이 아닌 경우 직책에 따른 권한 필터링
    const jobType = admin.job_type || '';
    const isFullAccess = admin.employee_id === 'admin' || 
                        jobType.includes('대표이사') || 
                        jobType.includes('보안담당');
    
    if (!isFullAccess) {
      // 본부장: 본부 기준 필터링
      if (jobType.includes('본부장')) {
        if (admin.division && admin.division !== '전체') {
          query += ` AND e.division = $${paramIndex}`;
          params.push(admin.division);
          paramIndex++;
        }
      }
      // 센터장 또는 팀장: 센터/팀 기준 필터링
      else if (jobType.includes('센터장') || jobType.includes('팀장')) {
        if (admin.division && admin.division !== '전체') {
          query += ` AND e.division = $${paramIndex}`;
          params.push(admin.division);
          paramIndex++;
        }
        if (admin.center_team && admin.center_team !== '전체') {
          query += ` AND e.center_team = $${paramIndex}`;
          params.push(admin.center_team);
          paramIndex++;
        }
      }
      // 그룹장: 그룹 기준 필터링 (그룹이 비어있으면 센터/팀까지)
      else if (jobType.includes('그룹장')) {
        if (admin.division && admin.division !== '전체') {
          query += ` AND e.division = $${paramIndex}`;
          params.push(admin.division);
          paramIndex++;
        }
        if (admin.center_team && admin.center_team !== '전체') {
          query += ` AND e.center_team = $${paramIndex}`;
          params.push(admin.center_team);
          paramIndex++;
        }
        if (admin.group_name && admin.group_name !== '전체' && admin.group_name.trim() !== '') {
          query += ` AND e.group_name = $${paramIndex}`;
          params.push(admin.group_name);
          paramIndex++;
        }
      }
      // 실장: 실 기준 필터링 (실이 비어있으면 센터/팀까지)
      else if (jobType.includes('실장')) {
        if (admin.division && admin.division !== '전체') {
          query += ` AND e.division = $${paramIndex}`;
          params.push(admin.division);
          paramIndex++;
        }
        if (admin.center_team && admin.center_team !== '전체') {
          query += ` AND e.center_team = $${paramIndex}`;
          params.push(admin.center_team);
          paramIndex++;
        }
        if (admin.department && admin.department !== '전체' && admin.department.trim() !== '') {
          query += ` AND e.department = $${paramIndex}`;
          params.push(admin.department);
          paramIndex++;
        }
      }
      // 기타 직책: 기본적으로 센터/팀까지만 조회
      else {
        if (admin.division && admin.division !== '전체') {
          query += ` AND e.division = $${paramIndex}`;
          params.push(admin.division);
          paramIndex++;
        }
        if (admin.center_team && admin.center_team !== '전체') {
          query += ` AND e.center_team = $${paramIndex}`;
          params.push(admin.center_team);
          paramIndex++;
        }
      }
    }
    
    query += ' ORDER BY e.employee_id';
    
    const result = await pool.query(query, params);
    
    res.render('admin/dashboard', {
      user: admin,
      employees: result.rows,
      today: today,
      selectedDate: selectedDate
    });
  } catch (err) {
    console.error(err);
    return res.status(500).send('서버 오류가 발생했습니다.');
  }
});

// 관리자 - 엑셀 다운로드 (누적 데이터)
app.get('/admin/download-excel', async (req, res) => {
  if (!req.session.user || req.session.user.type !== 'admin') {
    return res.status(401).send('권한이 없습니다.');
  }
  
  const admin = req.session.user;
  
  try {
    let query = `
      SELECT e.employee_id as "사번", 
             e.name as "이름",
             e.job_type as "직군",
             e.division as "본부",
             e.center_team as "센터/팀",
             e.group_name as "그룹",
             e.department as "실",
             cr.check_date as "체크일자",
             cr.check_time as "체크시간",
             CASE WHEN cr.completed = 1 THEN '완료' ELSE '미완료' END as "완료여부"
      FROM employees e
      LEFT JOIN check_records cr ON e.employee_id = cr.employee_id
      WHERE 1=1
    `;
    
    const params = [];
    let paramIndex = 1;
    
    // 슈퍼 관리자(admin), 대표이사, 보안담당이 아닌 경우 직책에 따른 권한 필터링
    const jobType = admin.job_type || '';
    const isFullAccess = admin.employee_id === 'admin' || 
                        jobType.includes('대표이사') || 
                        jobType.includes('보안담당');
    
    if (!isFullAccess) {
      // 본부장: 본부 기준 필터링
      if (jobType.includes('본부장')) {
        if (admin.division && admin.division !== '전체') {
          query += ` AND e.division = $${paramIndex}`;
          params.push(admin.division);
          paramIndex++;
        }
      }
      // 센터장 또는 팀장: 센터/팀 기준 필터링
      else if (jobType.includes('센터장') || jobType.includes('팀장')) {
        if (admin.division && admin.division !== '전체') {
          query += ` AND e.division = $${paramIndex}`;
          params.push(admin.division);
          paramIndex++;
        }
        if (admin.center_team && admin.center_team !== '전체') {
          query += ` AND e.center_team = $${paramIndex}`;
          params.push(admin.center_team);
          paramIndex++;
        }
      }
      // 그룹장: 그룹 기준 필터링 (그룹이 비어있으면 센터/팀까지)
      else if (jobType.includes('그룹장')) {
        if (admin.division && admin.division !== '전체') {
          query += ` AND e.division = $${paramIndex}`;
          params.push(admin.division);
          paramIndex++;
        }
        if (admin.center_team && admin.center_team !== '전체') {
          query += ` AND e.center_team = $${paramIndex}`;
          params.push(admin.center_team);
          paramIndex++;
        }
        if (admin.group_name && admin.group_name !== '전체' && admin.group_name.trim() !== '') {
          query += ` AND e.group_name = $${paramIndex}`;
          params.push(admin.group_name);
          paramIndex++;
        }
      }
      // 실장: 실 기준 필터링 (실이 비어있으면 센터/팀까지)
      else if (jobType.includes('실장')) {
        if (admin.division && admin.division !== '전체') {
          query += ` AND e.division = $${paramIndex}`;
          params.push(admin.division);
          paramIndex++;
        }
        if (admin.center_team && admin.center_team !== '전체') {
          query += ` AND e.center_team = $${paramIndex}`;
          params.push(admin.center_team);
          paramIndex++;
        }
        if (admin.department && admin.department !== '전체' && admin.department.trim() !== '') {
          query += ` AND e.department = $${paramIndex}`;
          params.push(admin.department);
          paramIndex++;
        }
      }
      // 기타 직책: 기본적으로 센터/팀까지만 조회
      else {
        if (admin.division && admin.division !== '전체') {
          query += ` AND e.division = $${paramIndex}`;
          params.push(admin.division);
          paramIndex++;
        }
        if (admin.center_team && admin.center_team !== '전체') {
          query += ` AND e.center_team = $${paramIndex}`;
          params.push(admin.center_team);
          paramIndex++;
        }
      }
    }
    
    query += ' ORDER BY e.employee_id, cr.check_date DESC';
    
    const result = await pool.query(query, params);
    
    const worksheet = xlsx.utils.json_to_sheet(result.rows);
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
  } catch (err) {
    console.error(err);
    return res.status(500).send('서버 오류가 발생했습니다.');
  }
});

// 구성원 정보 업로드
app.post('/admin/upload-employees', upload.single('file'), async (req, res) => {
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
    
    for (const row of data) {
      await pool.query(
        `INSERT INTO employees (employee_id, name, job_type, division, center_team, group_name, department)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (employee_id) 
         DO UPDATE SET name = $2, job_type = $3, division = $4, center_team = $5, group_name = $6, department = $7`,
        [
          row['사번'] || row['employee_id'],
          row['이름'] || row['name'],
          row['직군'] || row['job_type'],
          row['본부'] || row['division'],
          row['센터/팀'] || row['center_team'],
          row['그룹'] || row['group_name'],
          row['실'] || row['department']
        ]
      );
    }
    
    res.json({ success: true, message: `${data.length}명의 구성원 정보가 업로드되었습니다.` });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: '파일 처리 중 오류가 발생했습니다.' });
  }
});

// 관리자 정보 업로드
app.post('/admin/upload-admins', upload.single('file'), async (req, res) => {
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
    
    for (const row of data) {
      await pool.query(
        `INSERT INTO admins (employee_id, name, password, job_type, division, center_team, group_name, department)
         VALUES ($1, $2, '1234', $3, $4, $5, $6, $7)
         ON CONFLICT (employee_id) 
         DO UPDATE SET name = $2, job_type = $3, division = $4, center_team = $5, group_name = $6, department = $7`,
        [
          row['사번'] || row['employee_id'],
          row['이름'] || row['name'],
          row['직군'] || row['job_type'],
          row['본부'] || row['division'],
          row['센터/팀'] || row['center_team'],
          row['그룹'] || row['group_name'],
          row['실'] || row['department']
        ]
      );
    }
    
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

// 헬스 체크 엔드포인트
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
});

// 서버 시작
app.listen(PORT, '0.0.0.0', () => {
  console.log('========================================');
  console.log('🚀 서비스에이스 보안점검 시스템 시작');
  console.log(`📍 포트: ${PORT}`);
  console.log(`🌍 환경: ${process.env.NODE_ENV || 'development'}`);
  console.log(`📅 시작 시간: ${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}`);
  console.log('========================================');
  console.log(`구성원 페이지: http://localhost:${PORT}/employee/login`);
  console.log(`관리자 페이지: http://localhost:${PORT}/admin/login`);
});
