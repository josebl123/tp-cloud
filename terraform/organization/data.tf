# Lo que existe en la cuenta y no administra este código: quién está desplegando, dónde, y el único
# rol que el Learner Lab deja usar.

data "aws_caller_identity" "current" {}

data "aws_region" "current" {}

# La partición (aws, aws-cn, aws-us-gov) para armar ARNs sin escribirla a mano.
data "aws_partition" "current" {}

data "aws_iam_role" "lab" {
  name = var.lab_role_name
}

# Permite que S3 entregue los registros de acceso de los otros buckets en el de logs, y solo los de
# esta cuenta y esos buckets.
data "aws_iam_policy_document" "access_logs_delivery" {
  statement {
    sid       = "EntregaDeRegistrosDeAcceso"
    effect    = "Allow"
    actions   = ["s3:PutObject"]
    resources = ["arn:${data.aws_partition.current.partition}:s3:::${local.bucket_names.logs}/*"]

    principals {
      type        = "Service"
      identifiers = ["logging.s3.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [local.account_id]
    }

    condition {
      test     = "ArnLike"
      variable = "aws:SourceArn"
      values   = [for name in values(local.logged_bucket_names) : "arn:${data.aws_partition.current.partition}:s3:::${name}"]
    }
  }
}
