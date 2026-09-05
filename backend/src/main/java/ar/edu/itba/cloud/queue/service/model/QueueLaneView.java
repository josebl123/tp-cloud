package ar.edu.itba.cloud.queue.service.model;

import ar.edu.itba.cloud.queue.persistence.entity.LaneCapacityMode;
import java.math.BigDecimal;
import java.util.UUID;

public record QueueLaneView(UUID id, String name, int minPartySize, Integer maxPartySize, int priority,
                            LaneCapacityMode capacityMode, Integer maxSize, BigDecimal timeFactor, boolean active) { }
