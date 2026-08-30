package ar.edu.itba.cloud.queue.config;

import io.swagger.v3.oas.models.Components;
import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.info.Info;
import io.swagger.v3.oas.models.security.SecurityRequirement;
import io.swagger.v3.oas.models.security.SecurityScheme;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class OpenApiConfig {

    static final String BEARER_SCHEME = "bearerAuth";

    @Bean
    public OpenAPI queueOpenApi() {
        return new OpenAPI()
                .info(new Info()
                        .title("Q (Queue) API")
                        .version("v1")
                        .description("""
                                Cloud queue-management platform.

                                Two audiences share one API:
                                * `/api/v1/public/**` - anonymous customers, authorised by an opaque ticket token.
                                * everything else - staff, authorised by a bearer JWT.
                                """))
                .components(new Components().addSecuritySchemes(BEARER_SCHEME,
                        new SecurityScheme()
                                .type(SecurityScheme.Type.HTTP)
                                .scheme("bearer")
                                .bearerFormat("JWT")))
                .addSecurityItem(new SecurityRequirement().addList(BEARER_SCHEME));
    }
}
