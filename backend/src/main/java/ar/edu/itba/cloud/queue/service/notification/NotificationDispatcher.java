package ar.edu.itba.cloud.queue.service.notification;

import ar.edu.itba.cloud.queue.persistence.entity.NotificationChannel;
import ar.edu.itba.cloud.queue.persistence.entity.NotificationRecord;
import ar.edu.itba.cloud.queue.persistence.entity.NotificationStatus;
import ar.edu.itba.cloud.queue.persistence.repository.NotificationRecordRepository;
import ar.edu.itba.cloud.queue.service.EventRecorder;
import ar.edu.itba.cloud.queue.persistence.entity.EventType;
import ar.edu.itba.cloud.queue.persistence.entity.QueueEntry;
import ar.edu.itba.cloud.queue.persistence.repository.QueueEntryRepository;
import ar.edu.itba.cloud.queue.service.event.NotificationQueuedEvent;
import java.time.Clock;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.event.TransactionalEventListener;
import org.springframework.scheduling.annotation.Scheduled;

/**
 * Delivers queued notifications once the change that caused them is durable.
 *
 * <p>Listening after commit is what prevents the embarrassing case of telling a customer "it's your
 * turn" for a transaction that then rolls back. A delivery failure is recorded on the row and never
 * propagated: a broken SMTP server must not undo a legitimate queue movement.
 */
@Component
public class NotificationDispatcher {

    private static final Logger log = LoggerFactory.getLogger(NotificationDispatcher.class);

    private final NotificationRecordRepository repository;
    private final List<NotificationSender> senders;
    private final Clock clock;
    private final EventRecorder eventRecorder;
    private final QueueEntryRepository entryRepository;

    public NotificationDispatcher(NotificationRecordRepository repository,
                                  List<NotificationSender> senders,
                                  Clock clock, EventRecorder eventRecorder, QueueEntryRepository entryRepository) {
        this.repository = repository;
        this.senders = senders;
        this.clock = clock;
        this.eventRecorder = eventRecorder;
        this.entryRepository = entryRepository;
    }

    @TransactionalEventListener(fallbackExecution = true)
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void onNotificationQueued(NotificationQueuedEvent event) {
        deliver(event.notificationId());
    }

    @Scheduled(fixedDelayString = "${q.notifications.retry-interval:1m}")
    @Transactional
    public void retryFailed() {
        repository.findTop50ByStatusOrderByCreatedAtAsc(NotificationStatus.FAILED)
                .forEach(record -> { record.markPending(); repository.save(record); deliver(record.getId()); });
    }

    private void deliver(UUID notificationId) {
        NotificationRecord record = repository.findById(notificationId).orElse(null);
        if (record == null || record.getStatus() != NotificationStatus.PENDING) {
            return;
        }

        NotificationSender sender = senderFor(record.getChannel());
        try {
            sender.send(new NotificationMessage(record.getDestination(), record.getSubject(), record.getBody()));
            record.markSent(clock.instant());
            entryRepository.findByIdWithQueue(record.getEntryId()).ifPresent(e -> eventRecorder.recordBySystem(
                    e.getQueue().getId(), e.getId(), EventType.NOTIFICATION_SENT, "notificationId=%s".formatted(record.getId())));
        } catch (Exception ex) {
            log.warn("Failed to deliver notification {} over {}: {}",
                    notificationId, record.getChannel(), ex.getMessage());
            record.markFailed(ex.getMessage());
            entryRepository.findByIdWithQueue(record.getEntryId()).ifPresent(e -> eventRecorder.recordBySystem(
                    e.getQueue().getId(), e.getId(), EventType.NOTIFICATION_FAILED, "notificationId=%s".formatted(record.getId())));
        }
        repository.save(record);
    }

    /** Falls back to the logging transport when the intended one is unavailable. */
    private NotificationSender senderFor(NotificationChannel channel) {
        Optional<NotificationSender> match = senders.stream()
                .filter(sender -> sender.channel() == channel && sender.isEnabled())
                .findFirst();
        return match.orElseGet(() -> senders.stream()
                .filter(sender -> sender.channel() == NotificationChannel.LOG)
                .findFirst()
                .orElseThrow(() -> new IllegalStateException("No notification sender available")));
    }
}
