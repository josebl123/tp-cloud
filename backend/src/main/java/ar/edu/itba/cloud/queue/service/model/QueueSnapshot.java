package ar.edu.itba.cloud.queue.service.model;

import java.time.Instant;
import java.util.List;

/** Everything the staff panel renders for one queue in a single payload. */
public record QueueSnapshot(
        QueueView queue,
        /** Entries still waiting, in service order. */
        List<EntryView> waiting,
        /** Entries already called or being attended. */
        List<EntryView> inService,
        int waitingCount,
        int inServiceCount,
        int averageServiceMinutes,
        boolean usingDefaultServiceTime,
        Instant generatedAt,
        List<QueueLaneSnapshot> lanes) {
}
