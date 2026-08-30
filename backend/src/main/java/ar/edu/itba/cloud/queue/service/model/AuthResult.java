package ar.edu.itba.cloud.queue.service.model;

import java.time.Instant;

/** What a successful login or registration hands back to the SPA. */
public record AuthResult(
        String accessToken,
        String tokenType,
        long expiresInSeconds,
        Instant expiresAt,
        UserView user,
        EstablishmentView establishment) {
}
