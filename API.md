# Google Form Parser API

구글 폼 URL을 분석하여 설문 구조를 JSON으로 반환하는 API입니다.

## Base URL

```
https://3biqtf8lp1.execute-api.ap-northeast-2.amazonaws.com/google
```

---

## POST /

구글 폼 URL 목록을 받아 설문 구조를 파싱합니다.

### Request

**Headers**

| Key | Value |
|-----|-------|
| Content-Type | application/json |

**Body**

```json
{
  "urls": [
    "https://forms.gle/xxxxxxxx",
    "https://docs.google.com/forms/d/e/xxxxx/viewform"
  ]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| urls | string[] | Yes | 파싱할 구글 폼 URL 배열 |

### Response

**Success (200)**

```json
{
  "total_count": 1,
  "success_count": 1,
  "results": [
    {
      "url": "https://forms.gle/xxxxxxxx",
      "status": "SUCCESS",
      "survey": {
        "title": "설문 제목",
        "description": "설문 설명",
        "sections": [
          {
            "id": "550e8400-e29b-41d4-a716-446655440000",
            "title": "섹션 제목",
            "description": "섹션 설명",
            "questions": [
              {
                "order": 1,
                "id": "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
                "title": "질문 제목",
                "description": "질문 설명",
                "type": "multiple_choice",
                "required": true,
                "options": [
                  { "text": "옵션 1" },
                  { "text": "옵션 2" }
                ]
              }
            ]
          }
        ]
      },
      "unsupported_questions": [
        {
          "order": 5,
          "title": "지원하지 않는 질문",
          "type": "checkbox",
          "reason": "unsupported_question_type"
        }
      ]
    }
  ]
}
```

**Error (400)**

```json
{
  "error": "urls 배열이 필요합니다."
}
```

---

## Response Fields

### Root

| Field | Type | Description |
|-------|------|-------------|
| total_count | number | 요청한 URL 총 개수 |
| success_count | number | 파싱 성공한 URL 개수 |
| results | array | 각 URL별 파싱 결과 |

### Result (성공)

| Field | Type | Description |
|-------|------|-------------|
| url | string | 요청한 구글 폼 URL |
| status | string | `"SUCCESS"` |
| survey | object | 설문 데이터 |
| unsupported_questions | array | 지원하지 않는 질문 목록 |

### Result (실패)

| Field | Type | Description |
|-------|------|-------------|
| url | string | 요청한 구글 폼 URL |
| status | string | `"FAIL"` |
| message | string | 에러 메시지 |

### Survey

| Field | Type | Description |
|-------|------|-------------|
| title | string | 설문 제목 |
| description | string | 설문 설명 |
| sections | array | 섹션 배열 |

### Section

| Field | Type | Description |
|-------|------|-------------|
| id | string | 섹션 UUID |
| title | string | 섹션 제목 |
| description | string | 섹션 설명 |
| questions | array | 질문 배열 |

### Question

| Field | Type | Description |
|-------|------|-------------|
| order | number | 전체 질문 순서 (1부터 시작) |
| id | string | 질문 UUID |
| title | string | 질문 제목 |
| description | string | 질문 설명 |
| type | string | 질문 유형 |
| required | boolean | 필수 응답 여부 |
| options | array | 선택지 배열 (객관식 등) |

### Option

| Field | Type | Description |
|-------|------|-------------|
| text | string | 선택지 텍스트 |

---

## 지원하는 질문 유형 (type)

| Type | Description |
|------|-------------|
| short_answer | 단답형 |
| paragraph | 장문형 |
| multiple_choice | 객관식 |
| linear_scale | 선형 척도 |
| date | 날짜 |
| star_rating | 별점 |

## 지원하지 않는 질문 유형

아래 유형은 `unsupported_questions`에 포함되고, `sections.questions`에서 제외됩니다.

| Type | Description |
|------|-------------|
| dropdown | 드롭다운 |
| checkbox | 체크박스 |
| grid | 그리드 |
| time | 시간 |
| file_upload | 파일 업로드 |

---

## Example

### Request

```bash
curl -X POST https://3biqtf8lp1.execute-api.ap-northeast-2.amazonaws.com/google \
  -H "Content-Type: application/json" \
  -d '{"urls": ["https://forms.gle/P1CXaAgA95nA3TNx7"]}'
```

### Response

```json
{
  "total_count": 1,
  "success_count": 1,
  "results": [
    {
      "url": "https://forms.gle/P1CXaAgA95nA3TNx7",
      "status": "SUCCESS",
      "survey": {
        "title": "파티타임 설문",
        "description": "파티타임 참가 신청서입니다.",
        "sections": [
          {
            "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
            "title": "파티타임 설문",
            "description": "파티타임 참가 신청서입니다.",
            "questions": [
              {
                "order": 1,
                "id": "12345678-1234-1234-1234-123456789012",
                "title": "이름을 입력해주세요",
                "description": "",
                "type": "short_answer",
                "required": true,
                "options": []
              },
              {
                "order": 2,
                "id": "87654321-4321-4321-4321-210987654321",
                "title": "참석 여부",
                "description": "",
                "type": "multiple_choice",
                "required": true,
                "options": [
                  { "text": "참석" },
                  { "text": "불참" },
                  { "text": "미정" }
                ]
              }
            ]
          }
        ]
      },
      "unsupported_questions": []
    }
  ]
}
```

---

## Notes

- 구글 폼은 **공개 설정**이 되어 있어야 파싱이 가능합니다.
- 여러 URL을 동시에 요청하면 병렬로 처리됩니다.
- 개별 URL 파싱 실패 시에도 전체 요청은 200을 반환하며, 해당 결과만 `status: "FAIL"`로 표시됩니다.
