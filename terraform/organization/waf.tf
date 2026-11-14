# AWS WAF delante de la API REST, que sirve el sitio y la API. Filtra pedidos antes de que lleguen a
# API Gateway y a las funciones:
#
#   - un tope por IP en las rutas públicas, que cualquiera puede usar sin cuenta (anotarse en una
#     fila, ver un ticket): un bot que las inunda se bloquea antes de invocar una sola Lambda;
#   - las reglas que mantiene AWS contra ataques web comunes (inyección SQL, XSS, entradas maliciosas
#     conocidas) y contra IPs con mala reputación.
#
# La API WebSocket no se puede asociar a WAF; para conectarse ya pide un ticket de un solo uso.

locals {
  # Las reglas administradas, en el orden en que se evalúan después del tope por IP.
  waf_managed_rules = {
    comunes        = { name = "AWSManagedRulesCommonRuleSet", priority = 10 }
    entradas_malas = { name = "AWSManagedRulesKnownBadInputsRuleSet", priority = 20 }
    ips_maliciosas = { name = "AWSManagedRulesAmazonIpReputationList", priority = 30 }
  }
}

resource "aws_wafv2_web_acl" "api" {
  name        = format("%s-api", var.project)
  description = "Protege el sitio y la API REST de Queue."
  scope       = "REGIONAL"

  default_action {
    allow {}
  }

  rule {
    name     = "tope-rutas-publicas"
    priority = 1

    action {
      block {}
    }

    statement {
      rate_based_statement {
        limit                 = var.waf_public_rate_limit
        evaluation_window_sec = 60
        aggregate_key_type    = "IP"

        # Solo cuentan los pedidos a las rutas públicas: el sitio y el panel del staff no se limitan.
        scope_down_statement {
          byte_match_statement {
            search_string         = "/api/v1/public/"
            positional_constraint = "CONTAINS"

            field_to_match {
              uri_path {}
            }

            text_transformation {
              priority = 0
              type     = "NONE"
            }
          }
        }
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = format("%s-tope-rutas-publicas", var.project)
      sampled_requests_enabled   = true
    }
  }

  dynamic "rule" {
    for_each = local.waf_managed_rules

    content {
      name     = rule.value.name
      priority = rule.value.priority

      # Las acciones son las de AWS para cada regla del grupo: bloquear.
      override_action {
        none {}
      }

      statement {
        managed_rule_group_statement {
          vendor_name = "AWS"
          name        = rule.value.name
        }
      }

      visibility_config {
        cloudwatch_metrics_enabled = true
        metric_name                = format("%s-%s", var.project, rule.key)
        sampled_requests_enabled   = true
      }
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = format("%s-api", var.project)
    sampled_requests_enabled   = true
  }
}

resource "aws_wafv2_web_acl_association" "api" {
  resource_arn = aws_api_gateway_stage.this.arn
  web_acl_arn  = aws_wafv2_web_acl.api.arn
}
