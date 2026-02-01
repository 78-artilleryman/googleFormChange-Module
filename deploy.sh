#!/bin/bash
# AWS Lambda 배포 스크립트
# 사용 전: aws configure 로 자격증명 설정
# 환경변수: LAMBDA_FUNCTION_NAME (기본값: google-form-parser), AWS_REGION (선택)

set -e

FUNCTION_NAME="${LAMBDA_FUNCTION_NAME:-googleFormParser}"
REGION="${AWS_REGION:-ap-northeast-2}"

echo "📦 ZIP 파일 생성..."
zip -rq lambda-deploy.zip index.js node_modules -x '*.DS_Store'

echo "🚀 Lambda 업데이트 중: $FUNCTION_NAME (리전: $REGION)"
aws lambda update-function-code \
  --function-name "$FUNCTION_NAME" \
  --zip-file fileb://lambda-deploy.zip \
  --region "$REGION"

echo "✅ 배포 완료!"
