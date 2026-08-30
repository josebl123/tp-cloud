package ar.edu.itba.cloud.queue.service.model;

import java.time.Instant;
import java.util.UUID;

public record UserView(UUID id, String email, String displayName, Instant createdAt) {
}
