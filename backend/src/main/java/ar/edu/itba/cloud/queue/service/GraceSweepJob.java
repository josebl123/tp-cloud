package ar.edu.itba.cloud.queue.service;

import ar.edu.itba.cloud.queue.persistence.entity.EntryStatus;
import ar.edu.itba.cloud.queue.persistence.repository.QueueEntryRepository;
import java.time.Clock;
import java.util.List;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Keeps the line moving when nobody is looking.
 *
 * <p>Reads expire grace periods lazily, but a queue nobody is watching would otherwise stall on a
 * customer who was called and never showed up. This sweep closes that gap.
 *
 * <p>It only visits queues that actually have an expired entry, and the work itself runs in
 * {@link GraceService#expireQueue(UUID)}, which takes the same per-queue lock as every other mutation
 * - so the sweep never fights with staff working the panel.
 *
 * <p><strong>Scaling note:</strong> with several instances every replica would run this. The queue lock
 * keeps that correct - the second instance simply finds nothing left to expire - but a leader election
 * or a scheduled cloud trigger would avoid the duplicated work.
 */
@Component
public class GraceSweepJob {

    private static final Logger log = LoggerFactory.getLogger(GraceSweepJob.class);

    private final QueueEntryRepository entryRepository;
    private final GraceService graceService;
    private final Clock clock;

    public GraceSweepJob(QueueEntryRepository entryRepository, GraceService graceService, Clock clock) {
        this.entryRepository = entryRepository;
        this.graceService = graceService;
        this.clock = clock;
    }

    @Scheduled(fixedDelayString = "${q.grace.sweep-interval:10s}")
    public void sweep() {
        List<UUID> queueIds = entryRepository.findQueueIdsWithExpiredGrace(EntryStatus.CALLED, clock.instant());
        for (UUID queueId : queueIds) {
            try {
                graceService.expireQueue(queueId);
            } catch (Exception ex) {
                // One bad queue must not stop the others from being swept.
                log.warn("Grace sweep failed for queue {}: {}", queueId, ex.getMessage());
            }
        }
    }
}
