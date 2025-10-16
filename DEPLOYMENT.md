# 사내 보안 체크 시스템

회사 구성원들의 보안 점검을 관리하는 웹 애플리케이션입니다.

## 🚀 배포 방법 (Render)

### 1. GitHub에 푸시
```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/your-username/security-checker.git
git push -u origin main
```

### 2. Render 배포
1. https://render.com 접속
2. "New +" → "Web Service" 클릭
3. GitHub 저장소 연결
4. 설정:
   - **Name**: security-checker
   - **Region**: Singapore (가장 가까움)
   - **Branch**: main
   - **Root Directory**: (비워두기)
   - **Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
5. "Create Web Service" 클릭

### 3. 배포 완료!
- URL: `https://your-app-name.onrender.com`

## 📱 주요 기능

### 구성원용 페이지 (모바일)
- 사번으로 간편 로그인 (비밀번호 없음)
- 일일 보안 체크리스트
  - PC 전원 종료 확인
  - 잠금 장치 시건 확인
  - 개인정보/대외비 자료 보관 확인
- 1일 1회 체크 제한
- 매일 자정 자동 초기화
- 누적 체크 횟수 확인

### 관리자용 페이지 (PC)
- 사번 + 비밀번호 로그인
- **기본 관리자 계정**:
  - ID: `admin`
  - PW: `asdf1234`
- 날짜별 보안 체크 현황 조회
- 소속 구성원 보안 체크 현황 확인
- 엑셀 파일로 구성원/관리자 정보 업로드
- 누적 데이터 엑셀 다운로드

## 📊 엑셀 파일 형식

구성원 및 관리자 정보 업로드 시 다음 열이 포함되어야 합니다:

| 사번 | 이름 | 직군 | 본부 | 센터/팀 | 그룹 | 실 |
|------|------|------|------|---------|------|-----|
| 1104100 | 홍길동 | 기획 | 본부A | 팀1 | 그룹1 | 실1 |

## 🛠️ 기술 스택

- **Backend**: Node.js, Express.js
- **Database**: SQLite3
- **Template Engine**: EJS
- **File Upload**: Multer
- **Excel Processing**: XLSX
- **Task Scheduling**: node-cron
- **Session Management**: express-session

## 📝 로컬 실행

```bash
npm install
npm start
```

서버: http://localhost:3000

## 🔐 보안

- 세션 기반 인증
- 슈퍼 관리자 자동 생성 (ID: admin, PW: asdf1234)
- 일일 1회 체크 제한
- 체크 시간: 년월일시분 형식 (202510161415)

## 📞 문의

시스템 관련 문의는 시스템 관리자에게 연락하세요.
