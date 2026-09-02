package ar.edu.itba.cloud.queue.service;

import static org.assertj.core.api.Assertions.assertThat;

import ar.edu.itba.cloud.queue.persistence.entity.Establishment;
import ar.edu.itba.cloud.queue.persistence.entity.QueueEntry;
import ar.edu.itba.cloud.queue.persistence.entity.ServiceQueue;
import ar.edu.itba.cloud.queue.persistence.entity.SupportedLocale;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

@DisplayName("Order keys that define the line")
class QueueOrderingTest {

    private static final Instant NOW = Instant.parse("2026-03-01T12:00:00Z");

    private QueueOrdering ordering;
    private ServiceQueue queue;

    @BeforeEach
    void setUp() {
        ordering = new QueueOrdering();
        queue = new ServiceQueue(new Establishment("Demo", "UTC", NOW), "Mesas", NOW);
    }

    @Test
    @DisplayName("hands out increasing, gapped keys")
    void allocatesGappedKeys() {
        long first = ordering.keyForEnd(queue);
        long second = ordering.keyForEnd(queue);

        assertThat(second - first).isEqualTo(ServiceQueue.ORDER_KEY_GAP);
    }

    @Test
    @DisplayName("moving back past the end of the line lands at the end")
    void movingBackBeyondTheLineLandsAtTheEnd() {
        List<QueueEntry> waiting = line(2);

        long key = ordering.keyForPositionBack(queue, waiting, 5);

        assertThat(key).isGreaterThan(waiting.getLast().getOrderKey());
    }

    @Test
    @DisplayName("an empty line means the customer is first again")
    void emptyLineFallsBackToEnd() {
        long key = ordering.keyForPositionBack(queue, List.of(), 3);

        assertThat(key).isPositive();
    }

    @Test
    @DisplayName("moving back N positions lands strictly between the right neighbours")
    void landsBetweenNeighbours() {
        List<QueueEntry> waiting = line(4);

        long key = ordering.keyForPositionBack(queue, waiting, 2);

        assertThat(key).isGreaterThan(waiting.get(1).getOrderKey());
        assertThat(key).isLessThan(waiting.get(2).getOrderKey());
    }

    @Test
    @DisplayName("re-normalises when two neighbours have no gap left between them")
    void renormalisesWhenNeighboursAreAdjacent() {
        List<QueueEntry> waiting = line(3);
        // Squeeze positions 2 and 3 together so no midpoint exists.
        waiting.get(1).setOrderKey(100L);
        waiting.get(2).setOrderKey(101L);

        long key = ordering.keyForPositionBack(queue, waiting, 2);

        assertThat(key).isGreaterThan(waiting.get(1).getOrderKey());
        assertThat(key).isLessThan(waiting.get(2).getOrderKey());
        assertThat(waiting).extracting(QueueEntry::getOrderKey).isSorted();
    }

    @Test
    @DisplayName("re-normalising keeps the order and spreads the keys out again")
    void renormalisePreservesOrder() {
        List<QueueEntry> waiting = line(3);
        List<UUID> before = waiting.stream().map(QueueEntry::getTicketToken).toList();
        waiting.get(0).setOrderKey(7L);
        waiting.get(1).setOrderKey(8L);
        waiting.get(2).setOrderKey(9L);

        ordering.renormalize(queue, waiting);

        assertThat(waiting.stream().map(QueueEntry::getTicketToken).toList()).isEqualTo(before);
        assertThat(waiting).extracting(QueueEntry::getOrderKey)
                .containsExactly(ServiceQueue.ORDER_KEY_GAP,
                        2 * ServiceQueue.ORDER_KEY_GAP,
                        3 * ServiceQueue.ORDER_KEY_GAP);
        // The queue counter must never hand out a key that collides with the re-normalised line.
        assertThat(ordering.keyForEnd(queue)).isGreaterThan(3 * ServiceQueue.ORDER_KEY_GAP);
    }

    @Test
    @DisplayName("a customer sent to the end sorts behind everyone waiting")
    void endKeySortsLast() {
        List<QueueEntry> waiting = line(3);
        QueueEntry moved = waiting.removeFirst();

        moved.setOrderKey(ordering.keyForEnd(queue));
        List<QueueEntry> resorted = new ArrayList<>(waiting);
        resorted.add(moved);
        resorted.sort(Comparator.comparingLong(QueueEntry::getOrderKey));

        assertThat(resorted.getLast()).isSameAs(moved);
    }

    private List<QueueEntry> line(int size) {
        List<QueueEntry> entries = new ArrayList<>();
        for (int index = 0; index < size; index++) {
            entries.add(new QueueEntry(queue, UUID.randomUUID(), index + 1L, ordering.keyForEnd(queue),
                    "Customer " + index, "c%d@demo.q".formatted(index), null, null,
                    SupportedLocale.EN, NOW));
        }
        return entries;
    }
}
