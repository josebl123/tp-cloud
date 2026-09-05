package ar.edu.itba.cloud.queue.controller.dto;

import ar.edu.itba.cloud.queue.persistence.entity.NoShowPolicy;
import ar.edu.itba.cloud.queue.persistence.entity.CallStrategy;
import ar.edu.itba.cloud.queue.service.command.UpdateQueueCommand;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;

/**
 * Partial update: an omitted field is left untouched.
 *
 * <p>Three settings are genuinely nullable in the domain - {@code maxSize}, {@code notifyAtPosition}
 * and {@code notifyAtMinutes} - so "unset it" needs its own signal. Sending {@code clearMaxSize: true}
 * removes the limit, which a plain {@code null} could not express.
 */
public record UpdateQueueRequest(
        @Size(max = 120) String name,
        @Size(max = 500) String description,
        @Min(1) Integer serviceStations,
        @Min(1) Integer defaultServiceMinutes,
        @Min(1) Integer maxSize,
        boolean clearMaxSize,
        @PositiveOrZero Integer gracePeriodSeconds,
        NoShowPolicy noShowPolicy,
        @Min(1) Integer moveBackPositions,
        @Min(1) Integer notifyAtPosition,
        boolean clearNotifyAtPosition,
        @Min(1) Integer notifyAtMinutes,
        boolean clearNotifyAtMinutes,
        CallStrategy callStrategy) {

    public UpdateQueueCommand toCommand() {
        return new UpdateQueueCommand(name, description, serviceStations, defaultServiceMinutes,
                maxSize, clearMaxSize, gracePeriodSeconds, noShowPolicy, moveBackPositions,
                notifyAtPosition, clearNotifyAtPosition, notifyAtMinutes, clearNotifyAtMinutes,
                callStrategy);
    }
}
