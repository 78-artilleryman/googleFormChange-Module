const axios = require('axios');

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

            // 우리 서비스 전용 JSON 구조로 변환
            return {
                url: url,
                status: "SUCCESS",
                survey: {
                    title: rawData[8] || "제목 없는 설문",
                    description: rawData[1][0] || "",
                    questions: rawData[1][1].map((q, idx) => ({
                        order: idx + 1,
                        id: q[0],
                        title: q[1],
                        type: q[3], // 구글의 타입 번호 유지 (0: 단답, 1: 장문, 2: 객관식 등)
                        required: q[4]?.[0]?.[2] === 1,
                        options: q[4]?.[0]?.[1]?.map(opt => opt[0]) || []
                    }))
                }
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