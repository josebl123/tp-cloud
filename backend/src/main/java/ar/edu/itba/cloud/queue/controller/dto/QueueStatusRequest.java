package ar.edu.itba.cloud.queue.controller.dto;

import ar.edu.itba.cloud.queue.persistence.entity.QueueStatus;
import jakarta.validation.constraints.NotNull;

public record QueueStatusRequest(@NotNull QueueStatus status) {
}
