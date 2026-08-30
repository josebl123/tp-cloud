package ar.edu.itba.cloud.queue.service.notification;

import ar.edu.itba.cloud.queue.persistence.entity.NotificationChannel;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * Always-available fallback transport.
 *
 * <p>Guarantees notification behaviour is exercised end to end - the record, the de-duplication, the
 * audit event - even when no real transport is configured, which is exactly what the MVP and the
 * tests need.
 */
@Component
public class LoggingNotificationSender implements NotificationSender {

    private static final Logger log = LoggerFactory.getLogger(LoggingNotificationSender.class);

    @Override
    public NotificationChannel channel() {
        return NotificationChannel.LOG;
    }

    @Override
    public boolean isEnabled() {
        return true;
    }

    @Override
    public void send(NotificationMessage message) {
        log.info("[notification] to={} subject={} body={}",
                message.destination(), message.subject(), message.body());
    }
}
