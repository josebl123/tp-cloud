package ar.edu.itba.cloud.queue.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import ar.edu.itba.cloud.queue.persistence.entity.CallStrategy;
import ar.edu.itba.cloud.queue.persistence.entity.Establishment;
import ar.edu.itba.cloud.queue.persistence.entity.LaneCapacityMode;
import ar.edu.itba.cloud.queue.persistence.entity.QueueEntry;
import ar.edu.itba.cloud.queue.persistence.entity.QueueLane;
import ar.edu.itba.cloud.queue.persistence.entity.ServiceQueue;
import ar.edu.itba.cloud.queue.persistence.entity.SupportedLocale;
import java.lang.reflect.Field;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The selector decides who is served next, and the ETA simulator replays it to predict when. Both
 * answers come from here, so a mistake shows up twice: staff call the wrong group, and every customer
 * is quoted a time that never arrives.
 */
@DisplayName("Choosing who is served next")
class QueueEntrySelectorTest {

    private static final Instant NOW = Instant.parse("2026-03-01T12:00:00Z");

    private QueueEntrySelector selector;
    private ServiceQueue queue;
    private QueueLane small;
    private QueueLane large;

    @BeforeEach
    void setUp() {
        selector = new QueueEntrySelector();
        queue = new ServiceQueue(new Establishment("Parrilla", "America/Argentina/Buenos_Aires", NOW), "Tables", NOW);
        small = lane("1-2", 0);
        large = lane("3+", 1);
    }

    @Test
    @DisplayName("by default the oldest group goes first, whatever lane it is in")
    void globalAgeIgnoresLanes() {
        queue.setCallStrategy(CallStrategy.GLOBAL_AGE);
        QueueEntry first = entry(large, 1000);
        QueueEntry second = entry(small, 2000);

        assertThat(selector.select(queue, List.of(second, first), 0).entry()).isSameAs(first);
    }

    @Test
    @DisplayName("lane priority beats age, and age breaks ties inside a lane")
    void lanePriorityThenAge() {
        queue.setCallStrategy(CallStrategy.LANE_PRIORITY);
        QueueEntry oldestOverall = entry(large, 1000);
        QueueEntry priorityLane = entry(small, 3000);
        QueueEntry priorityLaneOlder = entry(small, 2000);

        assertThat(selector.select(queue, List.of(oldestOverall, priorityLane, priorityLaneOlder), 0).entry())
                .isSameAs(priorityLaneOlder);
    }

    @Test
    @DisplayName("round robin alternates lanes and hands back the next cursor")
    void roundRobinAlternates() {
        queue.setCallStrategy(CallStrategy.ROUND_ROBIN);
        QueueEntry smallFirst = entry(small, 1000);
        QueueEntry smallSecond = entry(small, 2000);
        QueueEntry largeFirst = entry(large, 3000);
        List<QueueEntry> waiting = List.of(smallFirst, smallSecond, largeFirst);

        QueueEntrySelector.Selection first = selector.select(queue, waiting, 0);
        assertThat(first.entry()).isSameAs(smallFirst);

        // The cursor it returns is what makes the next call land in the other lane.
        QueueEntrySelector.Selection second = selector.select(queue,
                List.of(smallSecond, largeFirst), first.nextRoundRobinPosition());
        assertThat(second.entry()).isSameAs(largeFirst);
    }

    @Test
    @DisplayName("round robin skips a lane with nobody waiting instead of stalling")
    void roundRobinSkipsEmptyLanes() {
        queue.setCallStrategy(CallStrategy.ROUND_ROBIN);
        QueueEntry onlyLarge = entry(large, 5000);

        // Cursor points past the only lane that still has anyone; it must wrap, not return nothing.
        assertThat(selector.select(queue, List.of(onlyLarge), 7).entry()).isSameAs(onlyLarge);
    }

    @Test
    @DisplayName("the same line and the same cursor always give the same answer")
    void isReproducible() {
        queue.setCallStrategy(CallStrategy.ROUND_ROBIN);
        List<QueueEntry> waiting = List.of(entry(small, 1000), entry(large, 2000), entry(small, 3000));

        QueueEntrySelector.Selection once = selector.select(queue, waiting, 1);
        QueueEntrySelector.Selection twice = selector.select(queue, waiting, 1);

        assertThat(once.entry()).isSameAs(twice.entry());
        assertThat(once.nextRoundRobinPosition()).isEqualTo(twice.nextRoundRobinPosition());
    }

    @Test
    @DisplayName("an empty line is a programming error, not an empty answer")
    void refusesAnEmptyLine() {
        assertThatThrownBy(() -> selector.select(queue, List.of(), 0))
                .isInstanceOf(IllegalArgumentException.class);
    }

    // --- fixtures ------------------------------------------------------------------------------

    private QueueLane lane(String name, int priority) {
        QueueLane lane = new QueueLane(queue, name, 1, null, priority,
                LaneCapacityMode.GROUPS, null, BigDecimal.ONE, NOW);
        // Lane ordering breaks ties on id, so the selector needs one; JPA would assign it on persist.
        setId(lane, UUID.randomUUID());
        return lane;
    }

    private QueueEntry entry(QueueLane lane, long orderKey) {
        QueueEntry entry = new QueueEntry(queue, lane, UUID.randomUUID(), orderKey / 1000, orderKey,
                "Customer " + orderKey, "c" + orderKey + "@q.test", null, 1, SupportedLocale.DEFAULT, NOW);
        setId(entry, UUID.randomUUID());
        return entry;
    }

    private static void setId(Object target, UUID value) {
        try {
            Field field = target.getClass().getDeclaredField("id");
            field.setAccessible(true);
            field.set(target, value);
        } catch (ReflectiveOperationException cause) {
            throw new IllegalStateException(cause);
        }
    }
}
