#!/usr/bin/env bash
# Crea y borra los buckets de la aplicación por fuera de Terraform.
#
# Por qué existe: después de crear un bucket con `aws_s3_bucket`, el provider lee su configuración de
# object lock, y el SCP del Learner Lab niega `s3:GetBucketObjectLockConfiguration` con un deny
# explícito. Ninguna de las versiones ensayadas del provider tolera ese AccessDenied (v4.67, v5.100
# y v6.67 lo tratan como error en la partición `aws`), y la lectura es incondicional. Las demás
# lecturas de S3 están permitidas, así que Terraform sigue administrando todo lo que va sobre cada
# bucket (módulo private-bucket): acceso público, propiedad de los objetos, versionado, política,
# registros de acceso, expiración y contenido. Esto solo los crea y, al destruir, los vacía y los borra.
#
# Los nombres los decide Terraform (output `bucket_names`); acá no se repite la regla. Se anotan en el
# bucket del estado antes de crear nada, así `delete` los encuentra aunque un apply se corte después
# de crearlos y antes de escribir sus outputs.
#
#   buckets.sh create <bucket-del-estado> <nombre>...   en el orden en que se van a borrar
#   buckets.sh delete <bucket-del-estado>
#   buckets.sh delete-state <bucket-del-estado>         al final del destroy, con el estado vacío
#
# Cada consulta distingue "no existe" (un 404) de "no se pudo comprobar" (permisos, credenciales
# vencidas, red, un bucket de otra cuenta). Solo lo primero se toma como ausencia; ante lo segundo se
# aborta sin tocar nada, y la lista de buckets anotados se conserva para poder reintentar.

set -euo pipefail

RECORD_KEY="queue/buckets.txt"
# Tope de vueltas al vaciar un bucket: cada una borra hasta 1000 objetos.
MAX_EMPTY_ROUNDS=500

fail() {
  echo "$*" >&2
  exit 1
}

# La cuenta de las credenciales: un bucket de otra cuenta con el mismo nombre no se adopta ni se borra.
ACCOUNT=$(aws sts get-caller-identity --query Account --output text) ||
  fail "No se pudieron validar las credenciales de AWS"

# "exists" o "missing". Cualquier otra respuesta de S3 corta el script.
bucket_status() {
  local name=$1 out
  if out=$(aws s3api head-bucket --bucket "$name" --expected-bucket-owner "$ACCOUNT" 2>&1); then
    echo exists
  elif grep -qE '\(404\)|Not Found' <<<"$out"; then
    echo missing
  else
    fail "No se pudo comprobar el bucket $name (no se asume que no existe): $out"
  fi
}

# La lista de buckets anotados, o nada si todavía no hay. Cualquier otro error corta el script.
read_record() {
  local state_bucket=$1 out
  if out=$(aws s3api head-object --bucket "$state_bucket" --key "$RECORD_KEY" \
    --expected-bucket-owner "$ACCOUNT" 2>&1); then
    # Con s3api y no `aws s3 cp`: el comando de alto nivel no acepta --expected-bucket-owner.
    local file
    file=$(mktemp)
    aws s3api get-object --bucket "$state_bucket" --key "$RECORD_KEY" \
      --expected-bucket-owner "$ACCOUNT" "$file" >/dev/null ||
      fail "No se pudo leer s3://${state_bucket}/${RECORD_KEY}"
    cat "$file"
    rm -f "$file"
  elif grep -qE '\(404\)|Not Found|NoSuchKey' <<<"$out"; then
    return 0
  else
    fail "No se pudo leer s3://${state_bucket}/${RECORD_KEY}: $out"
  fi
}

create() {
  local state_bucket=$1
  shift
  [ "$#" -gt 0 ] || fail "No hay buckets para crear: el plan no trajo bucket_names"

  # Los anotados antes y que ya no están en el plan (un bucket renombrado) se conservan, delante de
  # los nuevos: el destroy tiene que seguir encontrándolos, y el de logs sigue quedando último.
  local previous name wanted status
  local -a kept=()
  previous=$(read_record "$state_bucket")
  while IFS= read -r name; do
    [ -n "$name" ] || continue
    for wanted in "$@"; do
      [ "$name" != "$wanted" ] || continue 2
    done
    kept+=("$name")
  done <<<"$previous"

  local file
  file=$(mktemp)
  printf '%s\n' "${kept[@]}" "$@" | sed '/^$/d' >"$file"
  aws s3api put-object --bucket "$state_bucket" --key "$RECORD_KEY" --body "$file" \
    --expected-bucket-owner "$ACCOUNT" >/dev/null
  rm -f "$file"
  echo "Anotados en s3://${state_bucket}/${RECORD_KEY}"

  for name in "$@"; do
    status=$(bucket_status "$name")
    if [ "$status" = exists ]; then
      echo "Ya existe: $name"
      continue
    fi
    echo "Creando: $name"
    # En us-east-1 no se manda LocationConstraint; en cualquier otra región es obligatorio.
    if [ "${AWS_REGION}" = "us-east-1" ]; then
      aws s3api create-bucket --bucket "$name" >/dev/null
    else
      aws s3api create-bucket --bucket "$name" \
        --create-bucket-configuration "LocationConstraint=${AWS_REGION}" >/dev/null
    fi
    aws s3api wait bucket-exists --bucket "$name"
  done
}

# Borra todas las versiones y marcas de borrado, de a 1000 (el máximo de delete-objects). S3 puede
# aceptar el pedido y rechazar objetos sueltos: se revisa `Errors` en cada vuelta, porque si no, el
# mismo objeto volvería a aparecer en el listado siguiente para siempre.
empty() {
  local name=$1 listing batch count result errors round
  for ((round = 1; round <= MAX_EMPTY_ROUNDS; round++)); do
    listing=$(aws s3api list-object-versions --bucket "$name" --max-items 1000 \
      --expected-bucket-owner "$ACCOUNT" --output json)
    # Un bucket vacío puede no devolver nada: se toma como un listado sin objetos.
    [ -n "$listing" ] || listing='{}'
    batch=$(jq -c '{Objects: ([(.Versions // [])[], (.DeleteMarkers // [])[]] | map({Key, VersionId})), Quiet: true}' \
      <<<"$listing")
    count=$(jq '.Objects | length' <<<"$batch")
    [ "$count" -gt 0 ] || return 0
    result=$(aws s3api delete-objects --bucket "$name" --delete "$batch" \
      --expected-bucket-owner "$ACCOUNT" --output json)
    [ -n "$result" ] || result='{}'
    errors=$(jq '(.Errors // []) | length' <<<"$result")
    if [ "$errors" -gt 0 ]; then
      echo "S3 no pudo borrar $errors objetos de $name:" >&2
      jq -r '.Errors[:10][] | "  \(.Key) (versión \(.VersionId // "-")): \(.Code) \(.Message)"' <<<"$result" >&2
      exit 1
    fi
  done
  fail "No se terminó de vaciar $name después de $MAX_EMPTY_ROUNDS vueltas"
}

# Vacía y borra un bucket. S3 entrega los registros de acceso con minutos de atraso: alguno puede
# llegar al bucket de logs entre que se vacía y se borra, así que se reintenta en lugar de fallar.
remove_bucket() {
  local name=$1 attempt
  echo "Vaciando y borrando: $name"
  for attempt in 1 2 3 4 5 6; do
    empty "$name"
    if aws s3api delete-bucket --bucket "$name" --expected-bucket-owner "$ACCOUNT" 2>/dev/null; then
      return 0
    fi
    [ "$attempt" -lt 6 ] || fail "No se pudo borrar $name"
    sleep 10
  done
}

delete() {
  local state_bucket=$1 record name status
  local -a names
  record=$(read_record "$state_bucket")
  if [ -z "$record" ]; then
    echo "No hay buckets anotados en s3://${state_bucket}/${RECORD_KEY}: nada que borrar"
    return 0
  fi
  mapfile -t names <<<"$record"

  for name in "${names[@]}"; do
    [ -n "$name" ] || continue
    status=$(bucket_status "$name")
    if [ "$status" = missing ]; then
      echo "Ya no existe: $name"
      continue
    fi
    remove_bucket "$name"
  done

  # Recién con todos borrados se quita la lista: si algo falló antes, sigue ahí para reintentar.
  aws s3api delete-object --bucket "$state_bucket" --key "$RECORD_KEY" \
    --expected-bucket-owner "$ACCOUNT" >/dev/null
}

# Vacía y borra el bucket del estado, todas sus versiones incluidas. Solo después de un destroy
# completo: el workflow comprueba antes que el estado no tenga recursos. El apply siguiente lo vuelve
# a crear (.github/actions/terraform-init).
delete_state() {
  local state_bucket=$1 status
  status=$(bucket_status "$state_bucket")
  if [ "$status" = missing ]; then
    echo "Ya no existe: $state_bucket"
    return 0
  fi
  remove_bucket "$state_bucket"
}

case "${1:-}" in
  create) shift; create "$@" ;;
  delete) shift; delete "$@" ;;
  delete-state) shift; delete_state "$@" ;;
  *) echo "Uso: $0 create <bucket-del-estado> <nombre>... | delete <bucket-del-estado> | delete-state <bucket-del-estado>" >&2; exit 2 ;;
esac
