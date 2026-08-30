package ar.edu.itba.cloud.queue.service.model;

import java.time.Instant;
import java.util.UUID;

/**
 * Operational metrics for one queue or a whole establishment.
 *
 * <p>"Now" counters are live; the rest are computed over entries that finished inside the range.
 */
public record MetricsView(
        /** Null when the metrics cover a whole establishment. */
        UUID queueId,
        String scopeName,
        MetricsRange range,
        Instant from,
        Instant to,
        long waitingNow,
        long inServiceNow,
        long servedCount,
        long noShowCount,
        long leftCount,
        long finishedCount,
        Integer averageWaitMinutes,
        Integer averageServiceMinutes,
        /** Share of finished entries where the customer left on their own. */
        double abandonmentRate,
        /** Share of finished entries that ended as a no-show. */
        double noShowRate) {
}
