package ar.edu.itba.cloud.queue.realtime;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.NullSource;
import org.junit.jupiter.params.provider.ValueSource;

@DisplayName("What travels between instances on the change channel")
class QueueChangeNotificationTest {

    private static final UUID QUEUE = UUID.fromString("11111111-2222-3333-4444-555555555555");
    private static final String ORIGIN = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

    @Test
    @DisplayName("survives the round trip")
    void roundTrips() {
        QueueChangeNotification decoded =
                QueueChangeNotification.decode(new QueueChangeNotification(QUEUE, ORIGIN).encode());

        assertThat(decoded).isNotNull();
        assertThat(decoded.queueId()).isEqualTo(QUEUE);
        assertThat(decoded.origin()).isEqualTo(ORIGIN);
    }

    @Test
    @DisplayName("stays well inside the 8000-byte payload PostgreSQL allows")
    void fitsInAPayload() {
        assertThat(new QueueChangeNotification(QUEUE, ORIGIN).encode()).hasSizeLessThan(128);
    }

    @Test
    @DisplayName("an instance recognises its own announcement and lets someone else's through")
    void tellsItsOwnApart() {
        QueueChangeNotification notification = new QueueChangeNotification(QUEUE, ORIGIN);

        assertThat(notification.isFrom(ORIGIN)).isTrue();
        assertThat(notification.isFrom(UUID.randomUUID().toString())).isFalse();
    }

    /**
     * A malformed payload must come back as null rather than throw: it is read on the one thread that
     * serves every queue's announcements, and an exception there would take the channel down for all
     * of them.
     */
    @ParameterizedTest
    @NullSource
    @ValueSource(strings = {"", "|", "no-separator", "|only-origin", "11111111-2222-3333-4444-555555555555|",
            "not-a-uuid|origin"})
    @DisplayName("an unreadable payload is dropped, not thrown")
    void rejectsGarbage(String payload) {
        assertThat(QueueChangeNotification.decode(payload)).isNull();
    }

    @Test
    @DisplayName("an origin carrying the separator is refused at construction")
    void refusesAnAmbiguousOrigin() {
        assertThatThrownBy(() -> new QueueChangeNotification(QUEUE, "a|b"))
                .isInstanceOf(IllegalArgumentException.class);
    }
}
