package ar.edu.itba.cloud.queue.service.command;
import ar.edu.itba.cloud.queue.persistence.entity.LaneCapacityMode;
import java.math.BigDecimal;
public record QueueLaneCommand(String name, int minPartySize, Integer maxPartySize, int priority,
                               LaneCapacityMode capacityMode, Integer maxSize, BigDecimal timeFactor, Boolean active) { }
