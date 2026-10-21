# Las decisiones que comparten todos los buckets de Queue: nadie llega desde internet, todo acceso
# viaja por TLS y la propiedad de los objetos es siempre de la cuenta (sin ACLs). Versionado,
# expiración y registros de acceso son opcionales, porque no los necesita cada bucket.
#
# El bucket en sí no se crea acá: lo crea el pipeline (terraform/organization/scripts/buckets.sh)
# antes del apply. Después de crear un `aws_s3_bucket`, el provider lee su configuración de object
# lock, y el SCP del Learner Lab niega esa lectura con un deny explícito; ninguna de las versiones
# ensayadas del provider (4.67, 5.100 y 6.67) lo tolera. Todo lo que va sobre el bucket sí se
# administra acá, y cada una de esas lecturas está permitida.

data "aws_partition" "current" {}

locals {
  arn = "arn:${data.aws_partition.current.partition}:s3:::${var.name}"
}

resource "aws_s3_bucket_public_access_block" "this" {
  bucket = var.name

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "this" {
  bucket = var.name

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_versioning" "this" {
  count = var.versioning_enabled ? 1 : 0

  bucket = var.name

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "this" {
  count = var.expiration_days == null ? 0 : 1

  bucket = var.name

  rule {
    id     = "expirar"
    status = "Enabled"

    filter {}

    expiration {
      days = var.expiration_days
    }

    noncurrent_version_expiration {
      noncurrent_days = var.expiration_days
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }
}

resource "aws_s3_bucket_logging" "this" {
  count = var.access_logs_bucket == null ? 0 : 1

  bucket        = var.name
  target_bucket = var.access_logs_bucket
  target_prefix = var.access_logs_prefix
}

data "aws_iam_policy_document" "this" {
  source_policy_documents = var.additional_policy_documents

  statement {
    sid     = "SoloTLS"
    effect  = "Deny"
    actions = ["s3:*"]

    resources = [
      local.arn,
      "${local.arn}/*",
    ]

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "this" {
  bucket = var.name
  policy = data.aws_iam_policy_document.this.json

  # La política no referencia al bloqueo de acceso público, así que Terraform aplicaría los dos a la
  # vez. S3 rechaza dos cambios de configuración simultáneos sobre el mismo bucket
  # (OperationAborted), y además el bloqueo tiene que estar puesto antes de que exista cualquier
  # política.
  depends_on = [aws_s3_bucket_public_access_block.this]
}
