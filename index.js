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
const UNSUPPORTED_TYPES = [3, 7, 10, 13]; // dropdown, grid, time, file_upload
const OTHER_OPTION_TYPES = new Set([2, 4]); // multiple_choice, checkbox

function toSectionKey(value, sectionKeySet) {
    if (value == null) return null;
    const key = String(value);
    return sectionKeySet.has(key) ? key : null;
}

function collectSectionKeyCandidates(value, sectionKeySet, path = [], results = [], visited = new Set()) {
    if (value == null) return results;

    const directKey = toSectionKey(value, sectionKeySet);
    if (directKey) {
        results.push({
            key: directKey,
            path,
            depth: path.length,
            valueType: typeof value
        });
    }

    if (typeof value !== "object") return results;
    if (visited.has(value)) return results;
    visited.add(value);

    if (Array.isArray(value)) {
        value.forEach((item, idx) => collectSectionKeyCandidates(item, sectionKeySet, [...path, idx], results, visited));
        return results;
    }

    Object.entries(value).forEach(([k, child]) => {
        collectSectionKeyCandidates(child, sectionKeySet, [...path, k], results, visited);
    });

    return results;
}

function resolveOptionTargetSectionKey(opt, sectionKeySet) {
    // 옵션 텍스트(opt[0]) 같은 위치는 우선순위를 낮추고, 얕은 깊이의 숫자 키를 우선 선택
    const candidates = collectSectionKeyCandidates(opt, sectionKeySet)
        .filter(({ path, valueType }) => path.length > 0 && path[0] !== 0 && valueType === "number");

    if (candidates.length === 0) {
        const fallback = collectSectionKeyCandidates(opt, sectionKeySet)
            .filter(({ path }) => path.length > 0 && path[0] !== 0);
        return fallback[0]?.key ?? null;
    }

    candidates.sort((a, b) => a.depth - b.depth);
    return candidates[0].key;
}

function resolveSectionNextTargetKey(rawSectionItem, currentSectionKey, sectionKeySet) {
    // 섹션 아이템 전체에서 후보를 찾되, 현재 섹션 자기 키는 제외
    const candidates = collectSectionKeyCandidates(rawSectionItem, sectionKeySet)
        .filter(({ key, path }) => key !== currentSectionKey && !(path.length === 1 && path[0] === 0));

    if (candidates.length === 0) return null;

    // 얕은 깊이의 숫자 키를 우선해서 "다음 섹션" 타깃으로 해석
    const numericCandidates = candidates.filter(({ valueType }) => valueType === "number");
    const targetPool = numericCandidates.length > 0 ? numericCandidates : candidates;
    targetPool.sort((a, b) => a.depth - b.depth);
    return targetPool[0].key;
}

function mapOption(type, opt, sectionOrderByKey, sectionKeySet) {
    const text = typeof opt?.[0] === "string" ? opt[0] : "";
    const option = { text };
    const targetSectionKey = resolveOptionTargetSectionKey(opt, sectionKeySet);

    option.go_to_section_order = targetSectionKey
        ? sectionOrderByKey.get(targetSectionKey) ?? null
        : null;

    if (OTHER_OPTION_TYPES.has(type)) {
        const hasOtherFlag = [opt?.[4], opt?.[5], opt?.[6]].some(v => v === 1 || v === true);
        option.is_other = text.trim() === "" || hasOtherFlag;
    }

    return option;
}

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
            const sectionOrderByKey = new Map();
            let scannedSectionOrder = 1;

            allItems.forEach((item) => {
                if (item?.[3] === 8) {
                    scannedSectionOrder += 1;
                    if (item?.[0] != null) {
                        sectionOrderByKey.set(String(item[0]), scannedSectionOrder);
                    }
                }
            });

            const sectionKeySet = new Set(sectionOrderByKey.keys());
            let currentSectionOrder = 1;
            let currentSection = {
                id: crypto.randomUUID(),
                order: currentSectionOrder,
                sectionKey: null,
                rawSectionItem: null,
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
                    currentSectionOrder += 1;
                    currentSection = {
                        id: crypto.randomUUID(),
                        order: currentSectionOrder,
                        sectionKey: q?.[0] != null ? String(q[0]) : null,
                        rawSectionItem: q,
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
                            id: crypto.randomUUID(),
                            title: q[1],
                            description: q[2] || "",
                            type: TYPE_NAMES[type] ?? `unknown(${type})`,
                            required: q[4]?.[0]?.[2] === 1,
                            options: options.map(opt => mapOption(type, opt, sectionOrderByKey, sectionKeySet))
                        });
                    }
                }
            });

            // 마지막 섹션 저장
            if (currentSection.questions.length > 0 || currentSection.title) {
                sections.push(currentSection);
            }

            const normalizedSections = sections.map((section, index) => {
                const nextSection = index < sections.length - 1 ? sections[index + 1] : null;
                const defaultNextOrder = nextSection ? nextSection.order : null;
                // 구글 폼은 "섹션 N의 next" 정보를 섹션 N 자신이 아닌
                // 섹션 N+1의 헤더 index[5]에 저장한다 (off-by-one 구조)
                const customTargetKey = resolveSectionNextTargetKey(
                    nextSection?.rawSectionItem ?? null,
                    nextSection?.sectionKey ?? null,
                    sectionKeySet
                );
                const customNextOrder = customTargetKey
                    ? sectionOrderByKey.get(customTargetKey) ?? null
                    : null;

                return {
                    id: section.id,
                    order: section.order,
                    title: section.title,
                    description: section.description,
                    next_section_order: customNextOrder ?? defaultNextOrder,
                    questions: section.questions
                };
            });

            const totalSectionCount = normalizedSections.length;
            const totalQuestionCount = normalizedSections.reduce(
                (count, section) => count + section.questions.length,
                0
            );

            // 우리 서비스 전용 JSON 구조로 변환
            return {
                url: url,
                status: "SUCCESS",
                survey: {
                    title: rawData[8] || "제목 없는 설문",
                    description: rawData[1][0] || "",
                    total_section_count: totalSectionCount,
                    total_question_count: totalQuestionCount,
                    sections: normalizedSections
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
