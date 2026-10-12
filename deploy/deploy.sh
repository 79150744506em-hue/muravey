#!/usr/bin/env bash
# Выкладывает Муравья в Yandex Cloud. Запускается из GitHub Actions после сборки (dist/index.html).
# Нужны переменные: YC_SA_JSON_CREDENTIALS, YC_FOLDER_ID, MURAVEY_PASSWORD.
# Скрипт идемпотентный: при первом запуске создаёт ресурсы, потом только обновляет.
set -euo pipefail

: "${YC_SA_JSON_CREDENTIALS:?нет секрета YC_SA_JSON_CREDENTIALS}"
: "${YC_FOLDER_ID:?нет секрета YC_FOLDER_ID}"
: "${MURAVEY_PASSWORD:?нет секрета MURAVEY_PASSWORD}"

RUNTIME="${YC_FUNCTION_RUNTIME:-nodejs22}"
BUCKET="muravey-${YC_FOLDER_ID}"
SA_NAME="muravey-runtime"
FN_NAME="muravey-api"
GW_NAME="muravey"

KEY_FILE="$(mktemp)"
trap 'rm -f "$KEY_FILE" deploy/gateway.rendered.yaml' EXIT
printf '%s' "$YC_SA_JSON_CREDENTIALS" > "$KEY_FILE"
yc config set service-account-key "$KEY_FILE"
yc config set folder-id "$YC_FOLDER_ID"

echo "== Сервисный аккаунт для работы приложения"
SA_ID="$(yc iam service-account get --name "$SA_NAME" --format json 2>/dev/null | jq -r '.id // empty' || true)"
if [ -z "$SA_ID" ]; then
  SA_ID="$(yc iam service-account create --name "$SA_NAME" --format json | jq -r .id)"
fi
for ROLE in storage.editor functions.functionInvoker; do
  yc resource-manager folder add-access-binding --id "$YC_FOLDER_ID" --role "$ROLE" \
    --service-account-id "$SA_ID" >/dev/null 2>&1 || echo "роль $ROLE уже выдана"
done

echo "== Бакет $BUCKET"
if ! yc storage bucket get "$BUCKET" >/dev/null 2>&1; then
  yc storage bucket create --name "$BUCKET" --max-size 1073741824 >/dev/null
fi

echo "== Загружаю index.html"
IAM_TOKEN="$(yc iam create-token)"
curl -fsS -X PUT \
  -H "X-YaCloud-SubjectToken: $IAM_TOKEN" \
  -H "Content-Type: text/html; charset=utf-8" \
  -H "Cache-Control: no-cache" \
  --data-binary @dist/index.html \
  "https://storage.yandexcloud.net/$BUCKET/index.html"

echo "== Функция $FN_NAME"
if ! yc serverless function get --name "$FN_NAME" >/dev/null 2>&1; then
  yc serverless function create --name "$FN_NAME" >/dev/null
fi
PASSWORD_B64="$(printf '%s' "$MURAVEY_PASSWORD" | base64 -w0)"
yc serverless function version create \
  --function-name "$FN_NAME" \
  --runtime "$RUNTIME" \
  --entrypoint index.handler \
  --memory 128m \
  --execution-timeout 10s \
  --source-path api \
  --service-account-id "$SA_ID" \
  --environment "BUCKET=$BUCKET,MURAVEY_PASSWORD_B64=$PASSWORD_B64" >/dev/null
FN_ID="$(yc serverless function get --name "$FN_NAME" --format json | jq -r .id)"

echo "== API-шлюз $GW_NAME"
sed -e "s|__BUCKET__|$BUCKET|g" -e "s|__SA_ID__|$SA_ID|g" -e "s|__FUNCTION_ID__|$FN_ID|g" \
  deploy/gateway.yaml > deploy/gateway.rendered.yaml
if yc serverless api-gateway get --name "$GW_NAME" >/dev/null 2>&1; then
  yc serverless api-gateway update --name "$GW_NAME" --spec deploy/gateway.rendered.yaml >/dev/null
else
  yc serverless api-gateway create --name "$GW_NAME" --spec deploy/gateway.rendered.yaml >/dev/null
fi
DOMAIN="$(yc serverless api-gateway get --name "$GW_NAME" --format json | jq -r .domain)"

echo "Готово: https://$DOMAIN"
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  echo "### Муравей опубликован: https://$DOMAIN" >> "$GITHUB_STEP_SUMMARY"
fi
