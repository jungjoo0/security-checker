# 데이터베이스 영구 저장 가이드

## 문제점
- SQLite는 파일 기반이라 Render 무료 플랜에서 재시작 시 데이터 손실
- 15분간 접속 없으면 서버가 슬립 모드로 전환되며 재시작

## 해결 방법: PostgreSQL 사용

### 1. Render에서 PostgreSQL 생성
1. Render 대시보드: https://dashboard.render.com
2. "New +" → "PostgreSQL" 클릭
3. 설정:
   - Name: `security-checker-db`
   - Database: `securitychecker`
   - User: (자동 생성)
   - Region: `Singapore`
   - Instance Type: `Free` 선택
4. "Create Database" 클릭
5. **Internal Database URL** 복사 (예: `postgresql://user:pass@dpg-xxx.singapore-postgres.render.com/dbname`)

### 2. Web Service에 환경 변수 추가
1. Web Service (acesecuritychecker) 선택
2. "Environment" 탭 클릭
3. "Add Environment Variable" 클릭
4. Key: `DATABASE_URL`, Value: (복사한 Internal Database URL)
5. "Save Changes" 클릭

### 3. 코드 수정 필요
- SQLite → PostgreSQL 마이그레이션
- 또는 MongoDB Atlas 사용 (무료 512MB)

## 대안: MongoDB Atlas (더 쉬움)

### 장점
- 완전 무료 (512MB)
- 설정이 더 간단
- NoSQL이라 스키마 변경 유연

### 단계
1. MongoDB Atlas 가입: https://www.mongodb.com/cloud/atlas/register
2. 무료 클러스터 생성
3. Connection String 복사
4. 코드 수정 필요

어느 방법으로 하시겠습니까?
1. PostgreSQL (Render 통합, SQL 사용)
2. MongoDB Atlas (더 쉬움, NoSQL)

선택해주시면 코드를 자동으로 수정해드리겠습니다!
