package ar.edu.itba.cloud.queue.controller.dto;

import java.util.UUID;

/** Calls a specific customer when {@code entryId} is present, otherwise whoever is next in line. */
public record CallRequest(UUID entryId) {
}
