output "name" {
  description = "Nombre del bucket. Se entrega recién cuando el bucket está configurado del todo."
  value       = var.name

  # Quien usa el nombre no ve el versionado ni la política, porque son recursos aparte. Sin esto,
  # un objeto se podría subir antes de que el versionado esté activo y quedar sin version_id, que es
  # justo lo que necesita una Lambda para apuntar a su zip.
  depends_on = [
    aws_s3_bucket_versioning.this,
    aws_s3_bucket_policy.this,
  ]
}

output "arn" {
  description = "ARN del bucket, para políticas e integraciones."
  value       = local.arn
}
