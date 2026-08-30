package ar.edu.itba.cloud.queue.controller.dto;

import ar.edu.itba.cloud.queue.persistence.entity.EntryStatus;
import jakarta.validation.constraints.NotNull;

/** Target state for an entry. The service validates that the transition is legal. */
public record EntryStatusRequest(@NotNull EntryStatus status) {
}
