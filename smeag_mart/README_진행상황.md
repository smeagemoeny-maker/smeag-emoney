# SMEAG Mobile Mart — Android 프로젝트 진행 상황

무료 토큰 한도 때문에 요청하신 대로 지금까지 만든 부분을 압축해서 전달합니다.
아래 내용을 참고해서 이어서 진행/빌드하시면 됩니다.

## 1. 지금까지 완성된 것

**Android Studio 프로젝트 (Kotlin + Jetpack Compose)** — `app/` 폴더
목업 파일(`smeag-mobile-mart-mockup_3.html`)의 8개 화면을 실제 동작하는 코드로 옮겼습니다.

| 화면 | 파일 | 상태 |
|---|---|---|
| 로그인 (매니저) | `ui/screens/LoginScreen.kt` | mgperson 테이블로 실제 로그인 처리 |
| 물품등록 | `ui/screens/RegisterScreen.kt` | 사진 선택/촬영 + store_menus INSERT |
| 물품수정 | `ui/screens/ModifyScreen.kt` | 재고/기준/가격 UPDATE, LOW/품절 배지 |
| 판매 (NFC 결제) | `ui/screens/SalesScreen.kt` | 장바구니, 매니저15%/선생님10% 할인, NFC 태그 결제 |
| 결제완료(영수증) | `ui/screens/ReceiptScreen.kt` | 영수증 PDF 생성 + 공유(카카오톡 등) |
| 판매내역 | `ui/screens/HistoryScreen.kt` | 캠퍼스/기간별 bank 테이블 조회 |
| 주간리포트 | `ui/screens/ReportScreen.kt` | 매출/거래건수/일별 그래프/인기상품/재고부족 |
| 구매자정보 | `ui/screens/BuyerScreen.kt` | NFC 태그로 person 테이블 조회 |

**데이터 레이어**
- `data/DbConfig.kt`, `data/DbRepository.kt` — 제공해주신 `Database/database.docx`의 접속정보(host, user, password, database)로 MySQL(MariaDB 드라이버)에 **직접 JDBC 연결**하도록 구현했습니다. `mgperson`, `person`, `store_menus`, `bank` 4개 테이블 스키마를 그대로 반영했습니다.
- `nfc/NfcHelper.kt` — 스마트폰 내장 NFC로 카드 태그 시 UID를 읽어 결제/구매자조회 화면에 전달합니다.
- `utils/PdfUtil.kt` — 영수증 PDF 생성 후 다운로드 폴더 저장 + 공유시트(카카오톡 포함) 호출.
- 앱 아이콘: 올려주신 ICON 이미지를 각 해상도별(mipmap)로 자동 변환해 넣었습니다.

## 2. ⚠️ 꼭 확인해주세요 — 보안 관련 중요 사항

`database.docx`에 있던 MySQL 접속 정보(호스트/계정/비밀번호)를 앱 코드(`DbConfig.kt`)에 그대로 넣어 **APK에서 스마트폰이 운영 DB에 직접 접속**하는 구조로 만들었습니다.
이렇게 하면 지금 당장은 빌드해서 바로 테스트해볼 수 있지만, **이 APK를 디컴파일하면 누구나 운영 DB 계정정보(학생 개인정보, 잔액 포함)를 볼 수 있어 실제 서비스/배포용으로는 위험**합니다.

정식 배포 전에는:
1. PHP/Node 등으로 얇은 REST API 서버를 하나 만들고
2. 앱은 그 API만 호출하도록 바꾸는 작업

을 추가로 진행하시는 걸 권장드립니다 (원하시면 다음 세션에서 이 API 서버 코드도 만들어 드릴 수 있습니다).

## 3. 아직 안 된 것 / 다음에 이어서 할 것

- [x] ~~판매 화면 상품 썸네일 실제 이미지 표시~~ → `ProductThumbnail` 컴포넌트 추가, 판매/수정 화면에 적용 (아래 3-1 참고, ⚠️ 확인 필요).
- [x] ~~판매내역 화면에 거래일시(`transaction_date`) 표시 추가~~ → `BankTransaction.transactionDate` 필드 추가, `HistoryScreen`에 표시.
- [ ] **AI 이미지 인식으로 카트에 담기** (제안서 슬라이드 7): 판매 화면의 "📷 촬영으로 카트에 담기" 버튼은 자리만 있고 미구현 — TensorFlow Lite/Cloud Vision 연동 필요, 별도 작업량이 큽니다.
- [ ] 물품등록/수정 시 카메라로 찍은 사진을 서버(이미지 스토리지)에 업로드하는 부분 — 현재는 로컬 URI만 저장.
- [ ] 실제 ACR122U 대신 스마트폰 내장 NFC로 대체했는데, 카드가 ISO14443 규격이 아니면 인식이 안 될 수 있어 실물 카드로 테스트 필요.
- [ ] 로그인 비밀번호가 DB에 평문(`password` 컬럼)으로 저장되어 있음 — 실제 배포 시 해시 처리 권장.
- [ ] 전체적인 QA / 실기기 테스트 (아직 한 번도 빌드해보지 않은 상태입니다).

### 3-1. ⚠️ 상품 썸네일 관련 확인 필요

`store_menus.image_path`에는 `"ProductImg/Product.jpg"` 같은 상대경로만 들어있고, 이 이미지 파일을 실제로 어디서 HTTP로 내려받을 수 있는지는 넘겨주신 자료(`database.docx`, 목업 등) 어디에도 명시되어 있지 않았습니다.
일단 `data/ImageConfig.kt`에 "DB와 같은 호스트(`1.234.23.54`)에 웹서버가 떠 있고, 그 웹서버 루트에 `ProductImg/` 폴더가 그대로 서빙되고 있을 것"이라는 **가정**으로 `BASE_URL`을 넣어뒀습니다. 실제로 이미지가 어디서 서빙되는지 확인하신 후, 다르면 `ImageConfig.BASE_URL` 한 줄만 실제 주소로 바꿔주시면 됩니다. (이미지가 안 뜨면 회색 placeholder + 📦 아이콘으로 자동 대체되도록 만들어뒀습니다.)

## 4. 빌드 방법

1. Android Studio (Hedgehog 이상 권장)에서 이 폴더를 "Open" 으로 엽니다.
2. Gradle 동기화가 자동으로 진행됩니다 (인터넷 필요, Gradle 8.7 / AGP 8.5.2 / Kotlin 1.9.24 사용).
   - `gradle-wrapper.jar` 바이너리는 포함하지 않았습니다. Android Studio가 자동으로 받아오거나, 안 되면 터미널에서 `gradle wrapper` 한 번 실행해주세요.
3. 실제 기기(NFC 지원 필수) 또는 NFC를 지원하는 에뮬레이터로 실행합니다.
4. 로그인은 `Database/mgperson.sql`에 있는 계정(예: `ktManager` / `9201`)으로 테스트 가능합니다.

## 5. 원본 자료 (참고용, 압축에 그대로 포함되어 있음)

- `Database/` — 원본 SQL 덤프 3개 + 스키마 설명 docx
- `Proposal/` — 제안서 pptx
- `ICON/` — 원본 아이콘 이미지
- `Development source code/` — 승인된 HTML 목업 원본 2개 (실제 코드 작성 시 기준으로 사용)
