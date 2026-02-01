const axios = require('axios');
const crypto = require('crypto');

const TYPE_NAMES = {
    0: "short_answer",
    1: "paragraph",
    2: "multiple_choice",
    3: "dropdown",
    4: "checkbox",
    5: "linear_scale",
    7: "grid",
    8: "section",
    9: "date",
    10: "time",
    13: "file_upload",
    18: "star_rating"
};

// 서비스에서 지원하지 않는 타입
const UNSUPPORTED_TYPES = [3, 4, 7, 10, 13]; // dropdown, checkbox, grid, time, file_upload

exports.handler = async (event) => {
    // 1. 입력 데이터 파싱 (JSON 배열을 받음)
    // 요청 예시: { "urls": ["https://forms.gle/...", "https://docs.google.com/forms/..."] }
    const body = JSON.parse(event.body || "{}");
    const { urls } = body;

    if (!urls || !Array.isArray(urls)) {
        return {
            statusCode: 400,
            body: JSON.stringify({ error: "urls 배열이 필요합니다." })
        };
    }

    // 2. 여러 URL을 동시에 처리 (병렬 실행)
    const parsePromises = urls.map(async (url) => {
        try {
            // 구글 폼 페이지 GET 요청
            const response = await axios.get(url, { timeout: 8000 });
            const html = response.data;

            // HTML 내부의 데이터 변수 추출
            const regex = /var FB_PUBLIC_LOAD_DATA_ = (.*?);/s;
            const match = html.match(regex);

            if (!match) throw new Error("설문 데이터를 찾을 수 없습니다.");

            const rawData = JSON.parse(match[1]);

            // 섹션별로 구조화 (첫 번째 섹션 = 폼 제목·설명)
            const allItems = rawData[1][1];
            const formTitle = rawData[8] || "제목 없는 설문";
            const formDesc = rawData[1][0] || "";
            const sections = [];
            const unsupportedQuestions = []; // 지원하지 않는 질문들
            let currentSection = {
                id: crypto.randomUUID(),
                title: formTitle,
                description: formDesc,
                questions: []
            };

            allItems.forEach((q, idx) => {
                const type = q[3];
                
                // 섹션 헤더를 만나면 새 섹션 시작
                if (type === 8) {
                    if (currentSection.questions.length > 0 || currentSection.title) {
                        sections.push(currentSection);
                    }
                    currentSection = {
                        id: crypto.randomUUID(),
                        title: q[1],
                        description: q[2] || "",
                        questions: []
                    };
                } else {
                    // 지원하지 않는 타입이면 unsupportedQuestions에 추가
                    if (UNSUPPORTED_TYPES.includes(type)) {
                        unsupportedQuestions.push({
                            order: idx + 1,
                            title: q[1],
                            type: TYPE_NAMES[type] ?? `unknown(${type})`,
                            reason: "unsupported_question_type"
                        });
                    } else {
                        // 질문을 현재 섹션에 추가
                        const options = q[4]?.[0]?.[1] || [];
                        currentSection.questions.push({
                            order: idx + 1,
                            id: crypto.randomUUID(),
                            title: q[1],
                            description: q[2] || "",
                            type: TYPE_NAMES[type] ?? `unknown(${type})`,
                            required: q[4]?.[0]?.[2] === 1,
                            options: options.map(opt => ({ text: opt[0] }))
                        });
                    }
                }
            });

            // 마지막 섹션 저장
            if (currentSection.questions.length > 0 || currentSection.title) {
                sections.push(currentSection);
            }

            // 우리 서비스 전용 JSON 구조로 변환
            return {
                url: url,
                status: "SUCCESS",
                survey: {
                    title: rawData[8] || "제목 없는 설문",
                    description: rawData[1][0] || "",
                    sections: sections
                },
                unsupported_questions: unsupportedQuestions
            };
        } catch (error) {
            // 개별 링크 실패 시에도 전체 프로세스가 죽지 않도록 에러 정보 반환
            return {
                url: url,
                status: "FAIL",
                message: error.message
            };
        }
    });

    // 모든 처리가 완료될 때까지 대기
    const results = await Promise.all(parsePromises);

    // 3. 최종 결과 반환
    return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            total_count: urls.length,
            success_count: results.filter(r => r.status === "SUCCESS").length,
            results: results
        }, null, 2)
    };
};