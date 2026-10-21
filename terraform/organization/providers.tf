provider "aws" {
  region = var.region

  # Todo recurso que lo admita sale con estos tags, sin repetirlos en cada uno.
  default_tags {
    tags = local.tags
  }
}
