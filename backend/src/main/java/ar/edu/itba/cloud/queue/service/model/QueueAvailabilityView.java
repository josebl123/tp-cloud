package ar.edu.itba.cloud.queue.service.model;

/** A side-effect-free quote for a particular group size on the public join page. */
public record QueueAvailabilityView(
        QueueLaneView lane,
        boolean eligible,
        boolean available,
        boolean queueFull,
        boolean laneFull,
        Integer lanePosition,
        Integer laneGroupsAhead,
        int globalWaitingGroupsAhead,
        int groupsInService,
        Integer estimatedWaitMinutes) {
}
