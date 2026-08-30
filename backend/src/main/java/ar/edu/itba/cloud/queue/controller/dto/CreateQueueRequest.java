package ar.edu.itba.cloud.queue.controller.dto;

import ar.edu.itba.cloud.queue.persistence.entity.NoShowPolicy;
import ar.edu.itba.cloud.queue.service.command.CreateQueueCommand;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;

/** Only {@code name} is required; every other field falls back to the queue defaults. */
public record CreateQueueRequest(
        @NotBlank @Size(max = 120) String name,
        @Size(max = 500) String description,
        @Min(1) Integer serviceStations,
        @Min(1) Integer defaultServiceMinutes,
        @Min(1) Integer maxSize,
        @PositiveOrZero Integer gracePeriodSeconds,
        NoShowPolicy noShowPolicy,
        @Min(1) Integer moveBackPositions,
        @Min(1) Integer notifyAtPosition,
        @Min(1) Integer notifyAtMinutes,
        Boolean requirePartySize) {

    public CreateQueueCommand toCommand() {
        return new CreateQueueCommand(name, description, serviceStations, defaultServiceMinutes, maxSize,
                gracePeriodSeconds, noShowPolicy, moveBackPositions, notifyAtPosition, notifyAtMinutes,
                requirePartySize);
    }
}
