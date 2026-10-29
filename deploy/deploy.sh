#!/usr/bin/env bash
# Выкладывает Муравья в Yandex Cloud. Запускается из GitHub Actions после сборки (dist/index.html).
# Нужны переменные: YC_SA_JSON_CREDENTIALS, YC_FOLDER_ID, MURAVEY_PASSWORD (секрет для подписи ключей входа).
# Необязательная GOOGLE_CLIENT_ID включает вход через Google.
# Скрипт идемпотентный: при первом запуске создаёт ресурсы, потом только обновляет.
set -euo pipefail

# Повтор команды для нестабильных ответов API (Unavailable, DeadlineExceeded).
retry() {
  local n
  for n in 1 2 3 4; do
    if "$@"; then return 0; fi
    echo "попытка $n не удалась, жду $((n * 15)) с" >&2
    sleep $((n * 15))
  done
  "$@"
}

# Ошибки пишем в аннотации GitHub Actions, чтобы их было видно в сводке запуска.
ERR_LOG="$(mktemp)"
exec 2> >(tee -a "$ERR_LOG" >&2)
STEP="старт"
on_error() {
  local msg
  msg="$(tail -c 1500 "$ERR_LOG" | tr '\n' ' ' | sed 's/%/%25/g')"
  echo "::error title=Деплой упал на шаге: $STEP::строка $1: $2 :: $msg"
}
trap 'on_error $LINENO "$BASH_COMMAND"' ERR

for NAME in YC_SA_JSON_CREDENTIALS YC_FOLDER_ID MURAVEY_PASSWORD; do
  if [ -z "${!NAME:-}" ]; then
    echo "::error title=Нет секрета $NAME::Добавьте секрет $NAME в Settings → Secrets and variables → Actions"
    exit 1
  fi
done

RUNTIME="${YC_FUNCTION_RUNTIME:-nodejs22}"
BUCKET="muravey-${YC_FOLDER_ID}"
SA_NAME="muravey-runtime"
FN_NAME="muravey-api"
GW_NAME="muravey"

KEY_FILE="$(mktemp)"
trap 'rm -f "$KEY_FILE" "$ERR_LOG" deploy/gateway.rendered.yaml' EXIT
STEP="авторизация в Yandex Cloud"
printf '%s' "$YC_SA_JSON_CREDENTIALS" > "$KEY_FILE"
yc config set service-account-key "$KEY_FILE"
yc config set folder-id "$YC_FOLDER_ID"
yc config set endpoint api.cloud.yandex.net:443

STEP="Сервисный аккаунт для работы приложения"; echo "== Сервисный аккаунт для работы приложения"
SA_ID="$(yc iam service-account get --name "$SA_NAME" --format json 2>/dev/null | jq -r '.id // empty' || true)"
if [ -z "$SA_ID" ]; then
  SA_ID="$(yc iam service-account create --name "$SA_NAME" --format json | jq -r .id)"
fi
for ROLE in storage.editor functions.functionInvoker; do
  yc resource-manager folder add-access-binding --id "$YC_FOLDER_ID" --role "$ROLE" \
    --service-account-id "$SA_ID" >/dev/null 2>&1 || echo "роль $ROLE уже выдана"
done

STEP="Бакет $BUCKET"; echo "== Бакет $BUCKET"
if ! yc storage bucket get "$BUCKET" >/dev/null 2>&1; then
  yc storage bucket create --name "$BUCKET" --max-size 1073741824 >/dev/null
fi

STEP="Загружаю страницы"; echo "== Загружаю страницы"
IAM_TOKEN="$(yc iam create-token)"
for PAGE in index.html privacy.html; do
  curl -fsS -X PUT \
    -H "X-YaCloud-SubjectToken: $IAM_TOKEN" \
    -H "Content-Type: text/html; charset=utf-8" \
    -H "Cache-Control: no-cache" \
    --data-binary @"dist/$PAGE" \
    "https://storage.yandexcloud.net/$BUCKET/$PAGE"
done
# файлы для установки на телефон: манифест, офлайн-кэш, иконки, привязка Android-приложения к сайту
put_file() {
  curl -fsS -X PUT \
    -H "X-YaCloud-SubjectToken: $IAM_TOKEN" \
    -H "Content-Type: $2" \
    -H "Cache-Control: no-cache" \
    --data-binary @"dist/$1" \
    "https://storage.yandexcloud.net/$BUCKET/$1"
}
put_file manifest.webmanifest "application/manifest+json"
put_file sw.js "application/javascript; charset=utf-8"
put_file .well-known/assetlinks.json "application/json"
for ICON in icon-192.png icon-512.png icon-maskable-512.png apple-touch-icon.png; do
  put_file "$ICON" "image/png"
done

STEP="Функция $FN_NAME"; echo "== Функция $FN_NAME"
echo "::notice title=Диагностика::$(curl -s -o /dev/null -w 'serverless-functions.api %{http_code} за %{time_total}с' --max-time 20 https://serverless-functions.api.cloud.yandex.net/ || echo 'serverless-functions.api недоступен')"
if ! yc serverless function get --name "$FN_NAME" >/dev/null 2>&1; then
  retry yc serverless function create --name "$FN_NAME" >/dev/null
fi
PASSWORD_B64="$(printf '%s' "$MURAVEY_PASSWORD" | base64 -w0)"
echo "::add-mask::$PASSWORD_B64"
FN_ENV="BUCKET=$BUCKET,MURAVEY_PASSWORD_B64=$PASSWORD_B64"
# пустые значения переменных Yandex не принимает
if [ -n "${GOOGLE_CLIENT_ID:-}" ]; then FN_ENV="$FN_ENV,GOOGLE_CLIENT_ID=$GOOGLE_CLIENT_ID"; fi
retry yc serverless function version create \
  --function-name "$FN_NAME" \
  --runtime "$RUNTIME" \
  --entrypoint index.handler \
  --memory 128m \
  --execution-timeout 10s \
  --source-path api \
  --service-account-id "$SA_ID" \
  --environment "$FN_ENV" >/dev/null
FN_ID="$(yc serverless function get --name "$FN_NAME" --format json | jq -r .id)"

STEP="API-шлюз $GW_NAME"; echo "== API-шлюз $GW_NAME"
sed -e "s|__BUCKET__|$BUCKET|g" -e "s|__SA_ID__|$SA_ID|g" -e "s|__FUNCTION_ID__|$FN_ID|g" \
  deploy/gateway.yaml > deploy/gateway.rendered.yaml
if yc serverless api-gateway get --name "$GW_NAME" >/dev/null 2>&1; then
  yc serverless api-gateway update --name "$GW_NAME" --spec deploy/gateway.rendered.yaml >/dev/null
else
  yc serverless api-gateway create --name "$GW_NAME" --spec deploy/gateway.rendered.yaml >/dev/null
fi
DOMAIN="$(yc serverless api-gateway get --name "$GW_NAME" --format json | jq -r .domain)"

STEP="Проверка сайта"; echo "== Проверка сайта"
sleep 5
for PATH_ in / /privacy.html /manifest.webmanifest /sw.js /.well-known/assetlinks.json; do
  echo "GET $PATH_ → $(curl -s -o /dev/null -w '%{http_code}, %{size_download} байт' "https://$DOMAIN$PATH_")"
done
echo "POST /api ping → $(curl -s -X POST -H 'Content-Type: application/json' -d '{"action":"ping"}' "https://$DOMAIN/api")"
echo "POST /api login → $(curl -s -X POST -H 'Content-Type: application/json' -d '{"action":"login","email":"nobody@example.com","password":"x"}' "https://$DOMAIN/api")"

echo "Готово: https://$DOMAIN"
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  echo "### Муравей опубликован: https://$DOMAIN" >> "$GITHUB_STEP_SUMMARY"
fi
