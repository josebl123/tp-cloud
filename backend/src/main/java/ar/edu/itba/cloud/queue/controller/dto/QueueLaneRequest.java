package ar.edu.itba.cloud.queue.controller.dto;

import ar.edu.itba.cloud.queue.persistence.entity.LaneCapacityMode;
import java.math.BigDecimal;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;

public record QueueLaneRequest(@NotBlank String name, @Min(1) int minPartySize, Integer maxPartySize,
                               @Min(0) int priority, LaneCapacityMode capacityMode, Integer maxSize,
                               @DecimalMin("0.001") BigDecimal timeFactor, Boolean active) {
    public ar.edu.itba.cloud.queue.service.command.QueueLaneCommand toCommand() {
        return new ar.edu.itba.cloud.queue.service.command.QueueLaneCommand(name, minPartySize, maxPartySize,
                priority, capacityMode, maxSize, timeFactor, active);
    }
}
