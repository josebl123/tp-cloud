package ar.edu.itba.cloud.queue.security;

import java.util.UUID;
import org.springframework.security.oauth2.jwt.Jwt;

/** The staff member behind the current request, resolved from the bearer token. */
public record AuthenticatedUser(UUID id, String email) {

    public static AuthenticatedUser from(Jwt jwt) {
        return new AuthenticatedUser(UUID.fromString(jwt.getSubject()), jwt.getClaimAsString("email"));
    }
}
