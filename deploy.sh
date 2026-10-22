#!/usr/bin/env bash
# BanjirSiap one-command deploy. Needs: AWS CLI v2 signed in (aws login / aws configure).
set -euo pipefail
cd "$(dirname "$0")"
STACK=${STACK:-banjirsiap}
REGION=${DEPLOY_REGION:-us-east-1}   # Bedrock Nova lives here
export AWS_REGION=$REGION AWS_DEFAULT_REGION=$REGION
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
ART="banjirsiap-artifacts-${ACCOUNT}-${REGION}"
echo "==> Account $ACCOUNT, region $REGION"
if ! aws s3api head-bucket --bucket "$ART" 2>/dev/null; then
  if [ "$REGION" = "us-east-1" ]; then aws s3api create-bucket --bucket "$ART" >/dev/null
  else aws s3api create-bucket --bucket "$ART" --create-bucket-configuration LocationConstraint="$REGION" >/dev/null; fi
fi
echo "==> Packaging"
aws cloudformation package --template-file template.yaml --s3-bucket "$ART" --output-template-file .packaged.yaml >/dev/null
echo "==> Deploying stack $STACK (first time ~5 min for CloudFront)"
aws cloudformation deploy --template-file .packaged.yaml --stack-name "$STACK" \
  --capabilities CAPABILITY_IAM CAPABILITY_AUTO_EXPAND --no-fail-on-empty-changeset \
  ${MODEL_ID:+--parameter-overrides ModelId=$MODEL_ID}
out() { aws cloudformation describe-stacks --stack-name "$STACK" --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text; }
BUCKET=$(out SiteBucketName); DIST=$(out DistributionId); URL=$(out Url)
echo "==> Uploading frontend"
aws s3 sync frontend/ "s3://$BUCKET" --delete --exclude "media/*" --cache-control "no-cache" >/dev/null
aws cloudfront create-invalidation --distribution-id "$DIST" --paths "/*" >/dev/null
echo "==> Smoke test"
sleep 5
curl -s "$URL/api/health" || true
echo
echo "=================================================="
echo " LIVE: $URL"
echo "=================================================="
