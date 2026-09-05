package ar.edu.itba.cloud.queue.service.model;

import java.util.List;

/** Independent staff-board state for one active or historical lane. */
public record QueueLaneSnapshot(
        QueueLaneView lane,
        List<EntryView> waiting,
        List<EntryView> inService,
        int waitingGroups,
        int waitingPersons,
        int capacityUsed,
        Integer capacityMaximum) {
}
